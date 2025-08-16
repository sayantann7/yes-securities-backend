import { GetObjectCommand, PutObjectCommand, CopyObjectCommand, DeleteObjectCommand, ListObjectsV2Command, HeadObjectCommand } from '@aws-sdk/client-s3';
import { S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { Agent as HttpAgent } from 'http';
import { Agent as HttpsAgent } from 'https';
require('dotenv').config();

// Configure S3 client with proper timeouts, retries and keep-alive agents
const S3_CONN_TIMEOUT = parseInt(process.env.S3_CONN_TIMEOUT || '20000', 10); // 20s
const S3_REQ_TIMEOUT = parseInt(process.env.S3_REQ_TIMEOUT || '45000', 10);   // 45s
const S3_MAX_ATTEMPTS = parseInt(process.env.S3_MAX_ATTEMPTS || '5', 10);

const httpHandler = new NodeHttpHandler({
    connectionTimeout: S3_CONN_TIMEOUT,
    requestTimeout: S3_REQ_TIMEOUT,
    httpAgent: new HttpAgent({ keepAlive: true, maxSockets: 64 }),
    httpsAgent: new HttpsAgent({ keepAlive: true, maxSockets: 64 }),
});

const s3Client = new S3Client({ 
    region: process.env.AWS_REGION || 'ap-south-1',
    requestHandler: httpHandler,
    maxAttempts: S3_MAX_ATTEMPTS,
});

const bucket = process.env.S3_BUCKET_NAME;

// Cache for icon URLs to avoid repeated S3 calls
const iconCache = new Map<string, string | null>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const cacheTimestamps = new Map<string, number>();
const ICON_CACHE_MAX_ENTRIES = 5000;

function enforceIconCacheLimit() {
    if (iconCache.size <= ICON_CACHE_MAX_ENTRIES) return;
    const entries: Array<{ key: string; ts: number }> = [];
    for (const [key, ts] of cacheTimestamps.entries()) entries.push({ key, ts });
    entries.sort((a, b) => a.ts - b.ts);
    const toEvict = iconCache.size - ICON_CACHE_MAX_ENTRIES;
    for (let i = 0; i < toEvict; i++) {
        iconCache.delete(entries[i].key);
        cacheTimestamps.delete(entries[i].key);
    }
}

export interface GetSignedUrlParams {
    path: string;
}

/**
 * Build S3 key for a stored icon corresponding to an item path (file or folder)
 */
export function buildIconKey(itemPath: string, iconType: string = 'png'): string {
    const safe = String(itemPath || '')
        .replace(/^\/+/, '')
        .replace(/\/+$/, '')
        .replace(/[^a-zA-Z0-9._-]/g, '_');
    const ext = iconType.toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
    return `icons/${safe}_icon.${ext}`;
}

/**
 * Get a signed PUT URL to upload an icon for a given item path
 */
export async function getIconUploadUrl(itemPath: string, iconType: string = 'png'): Promise<string> {
    const key = buildIconKey(itemPath, iconType);
    const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: `image/${iconType === 'jpg' ? 'jpeg' : iconType}` });
    return await getSignedUrl(s3Client, command, { expiresIn: 3600 });
}

/**
 * Optimized icon URL retrieval with caching and concurrent processing
 */
export async function getCustomIconUrlOptimized(itemPath: string): Promise<string | null> {
    const cacheKey = canonicalKey(itemPath);
    const now = Date.now();

    // Check cache first
    if (iconCache.has(cacheKey)) {
        const timestamp = cacheTimestamps.get(cacheKey) || 0;
        if (now - timestamp < CACHE_TTL) {
            return iconCache.get(cacheKey) || null;
        }
    }

    try {
        const exts = ['png', 'jpg', 'jpeg', 'gif', 'webp'];
        const keyCandidates = exts.map((ext) => buildIconKey(cacheKey, ext));

        // Probe concurrently for first existing icon (HEAD requests, cheaper/faster than GET)
        const checks = keyCandidates.map(async (k) => {
            try {
                await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: k }));
                return k;
            } catch {
                return null;
            }
        });
        const results = await Promise.allSettled(checks);
        const found = results.find(r => r.status === 'fulfilled' && r.value);

        if (found && found.status === 'fulfilled' && found.value) {
            const iconUrl = await getSignedDownloadUrl(found.value);
            iconCache.set(cacheKey, iconUrl);
            cacheTimestamps.set(cacheKey, now);
            enforceIconCacheLimit();
            return iconUrl;
        }

        iconCache.set(cacheKey, null);
        cacheTimestamps.set(cacheKey, now);
        enforceIconCacheLimit();
        return null;
    } catch (err) {
        console.error('Error getting custom icon URL:', err);
        iconCache.set(cacheKey, null);
        cacheTimestamps.set(cacheKey, now);
        enforceIconCacheLimit();
        return null;
    }
}

/**
 * Batch process icon URLs with concurrency limit
 */
async function batchProcessIcons(items: string[], concurrencyLimit: number = 10): Promise<Map<string, string | null>> {
    const results = new Map<string, string | null>();
    
    // Process items in batches to avoid overwhelming S3
    for (let i = 0; i < items.length; i += concurrencyLimit) {
        const batch = items.slice(i, i + concurrencyLimit);
        const batchPromises = batch.map(async (item) => {
            const iconUrl = await getCustomIconUrlOptimized(item);
            return { item, iconUrl };
        });
        
        const batchResults = await Promise.allSettled(batchPromises);
        batchResults.forEach((result) => {
            if (result.status === 'fulfilled') {
                results.set(result.value.item, result.value.iconUrl);
            }
        });
    }
    
    return results;
}

function canonicalKey(input: string): string {
    // remove leading and trailing slashes
    return String(input || '').replace(/^\/+/, '').replace(/\/+$/, '');
}

function makePrefixes(prefix: string = ''): string[] {
    const raw = typeof prefix === 'string' ? prefix : '';
    const noSlash = canonicalKey(raw);
    const withSlash = noSlash ? `/${noSlash}` : '/';
    // Use a single normalized prefix to avoid duplicate S3 calls
    return [withSlash];
}

async function listOnce(prefix: string, maxItems: number) {
    const normalized = prefix ? (prefix.endsWith('/') ? prefix : `${prefix}/`) : '';
    const cmd = new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: normalized,
        Delimiter: "/",
        MaxKeys: maxItems,
    });
    const response = await s3Client.send(cmd);
    const folders: Array<{key: string}> = [];
    const files: Array<{key: string}> = [];

    if (response.CommonPrefixes) {
        response.CommonPrefixes.forEach(prefixObj => {
            const folderKey = prefixObj.Prefix || "";
            folders.push({ key: folderKey });
        });
    }

    if (response.Contents) {
        response.Contents.forEach(content => {
            const fileKey = content.Key || "";
            if (!fileKey.endsWith('/')) {
                files.push({ key: fileKey });
            }
        });
    }
    return { folders, files, isTruncated: !!response.IsTruncated, continuationToken: response.NextContinuationToken };
}

/**
 * Optimized list children with concurrent icon loading and limits; merges both '' and '/' roots.
 */
export async function listChildrenWithIconsOptimized(prefix: string = '', maxItems: number = 1000) {
    const variants = makePrefixes(prefix);
    const foldersMap = new Map<string, { key: string }>();
    const filesMap = new Map<string, { key: string }>();

    for (const v of variants) {
        const { folders, files } = await listOnce(v, maxItems);
        for (const f of folders) {
            const norm = canonicalKey(f.key);
            if (norm === 'icons' || norm.startsWith('icons/')) continue; // hide icons folder tree
            foldersMap.set(norm + '/', { key: norm + '/' });
        }
        for (const f of files) {
            const norm = canonicalKey(f.key);
            if (norm.startsWith('icons/')) continue; // hide icon objects
            filesMap.set(norm, { key: norm });
        }
    }

    // Only fetch icons for folders to reduce S3 calls and latency
    const folderKeys = Array.from(foldersMap.values()).map(f => f.key);
    const iconResults = await (async () => {
        const out = new Map<string, string | null>();
        const concurrency = 5;
        for (let i = 0; i < folderKeys.length; i += concurrency) {
            const batch = folderKeys.slice(i, i + concurrency);
            const promises = batch.map(async (k) => ({ k, url: await getCustomIconUrlOptimized(k) }));
            const res = await Promise.allSettled(promises);
            for (const r of res) {
                if (r.status === 'fulfilled') out.set(r.value.k, r.value.url);
            }
        }
        return out;
    })();

    const folders = Array.from(foldersMap.values()).map(f => ({ key: f.key, iconUrl: iconResults.get(f.key) || undefined }));
    const files = Array.from(filesMap.values()).map(f => ({ key: f.key })); // no icon lookup for files

    return { folders, files, isTruncated: false, continuationToken: undefined };
}

/**
 * Simple list without icons; merges both '' and '/' roots and dedupes.
 */
export async function listChildrenFast(prefix: string = '', maxItems: number = 1000) {
    try {
        const variants = makePrefixes(prefix);
        const foldersMap = new Map<string, { key: string }>();
        const filesMap = new Map<string, { key: string }>();

        for (const v of variants) {
            const { folders, files } = await listOnce(v, maxItems);
            for (const f of folders) {
                const norm = canonicalKey(f.key);
                if (norm === 'icons' || norm.startsWith('icons/')) continue; // hide icons folder tree
                foldersMap.set(norm + '/', { key: norm + '/' });
            }
            for (const f of files) {
                const norm = canonicalKey(f.key);
                if (norm.startsWith('icons/')) continue; // hide icon objects
                filesMap.set(norm, { key: norm });
            }
        }

        return {
            folders: Array.from(foldersMap.values()),
            files: Array.from(filesMap.values()),
            isTruncated: false,
            continuationToken: undefined
        };
    } catch (err) {
        console.error('Error in listChildrenFast:', err);
        throw err;
    }
}

// Re-export existing functions
export async function getSignedDownloadUrl(path: string): Promise<string> {
    let command = new GetObjectCommand({ Bucket: bucket, Key: path });
    return await getSignedUrl(s3Client, command, { expiresIn: 3600 });
}

export async function getSignedUploadUrl(path: string): Promise<string> {
    let command = new PutObjectCommand({ Bucket: bucket, Key: path });
    return await getSignedUrl(s3Client, command, { expiresIn: 3600 });
}

/**
 * Recursively delete a folder (all objects under a prefix)
 */
export async function deleteFolderRecursively(prefix: string): Promise<void> {
    const normalizedPrefix = prefix.endsWith('/') ? prefix : `${prefix}/`;
    let continuationToken: string | undefined = undefined;

    do {
        const listCmd = new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: normalizedPrefix,
            ContinuationToken: continuationToken,
        } as any);
        const response: any = await s3Client.send(listCmd);
        const objects = (response.Contents || []).map((o: any) => ({ Key: o.Key }));
        if (objects.length > 0) {
            // Delete in batches
            const batches: any[] = [];
            for (let i = 0; i < objects.length; i += 1000) {
                batches.push(objects.slice(i, i + 1000));
            }
            for (const batch of batches) {
                // Using individual deletes to avoid adding a new import; cheap under small sizes
                await Promise.all(batch.map((obj: any) => s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: obj.Key }))));
            }
        }
        continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);
}

export async function createFolder(prefix: string, name: string): Promise<void> {
    if (typeof name !== 'string' || name.trim() === '') {
        return void Promise.reject(new Error('Folder name is required'));
    }

    const normalizedPrefix = prefix ? prefix.replace(/\/?$/, '/') : '';
    const folderKey = `${normalizedPrefix}${name.replace(/\/?$/, '')}/`;

    try {
        await s3Client.send(new PutObjectCommand({
            Bucket: bucket,
            Key: folderKey,
            Body: '',
            ContentType: 'application/x-directory'
        }));
        return Promise.resolve();
    } catch (err) {
        console.error('Error creating folder:', err);
        return void Promise.reject(new Error('Failed to create folder'));
    }
}

// Delete a single file/object
export async function deleteFile(key: string): Promise<void> {
    try {
        await s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    } catch (err) {
        console.error('Error deleting file:', err);
        throw err;
    }
}

// Clear cache periodically (singleton)
declare global {
    // eslint-disable-next-line no-var
    var __iconCacheCleanupInterval__: ReturnType<typeof setInterval> | undefined;
}

if (!globalThis.__iconCacheCleanupInterval__) {
    globalThis.__iconCacheCleanupInterval__ = setInterval(() => {
        const now = Date.now();
        for (const [key, timestamp] of cacheTimestamps.entries()) {
            if (now - timestamp > CACHE_TTL) {
                iconCache.delete(key);
                cacheTimestamps.delete(key);
            }
        }
    }, 60000); // Clean up every minute
}

/**
 * Rename a folder by copying all objects from oldPrefix to newPrefix and deleting originals
 */
export async function renameFolderExact(oldPrefix: string, newPrefix: string): Promise<{ moved: number; deleted: number }> {
    const src = String(oldPrefix);
    const dst = String(newPrefix);

    let continuationToken: string | undefined = undefined;
    let moved = 0;
    let deleted = 0;

    do {
        const listCmd = new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: src,
            ContinuationToken: continuationToken,
        } as any);
        const response: any = await s3Client.send(listCmd);
        const contents: Array<{ Key: string }> = (response.Contents || []).filter((o: any) => !!o.Key);

        for (const obj of contents) {
            const relative = obj.Key.slice(src.length);
            const targetKey = `${dst}${relative}`;
            try {
                await s3Client.send(new CopyObjectCommand({
                    Bucket: bucket,
                    CopySource: `${bucket}/${obj.Key}`,
                    Key: targetKey,
                }));
                moved++;
                await s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: obj.Key }));
                deleted++;
            } catch (e) {
                console.error('Error moving object during rename:', obj.Key, '->', targetKey, e);
            }
        }

        continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);

    return { moved, deleted };
}
