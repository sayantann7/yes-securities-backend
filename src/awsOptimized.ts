import { GetObjectCommand, PutObjectCommand, CopyObjectCommand, DeleteObjectCommand, ListObjectsV2Command, HeadObjectCommand } from '@aws-sdk/client-s3';
import { S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { Agent as HttpAgent } from 'http';
import { Agent as HttpsAgent } from 'https';
require('dotenv').config();

// Configure S3 client with proper timeouts, retries and keep-alive agents
// Clamp timeouts to avoid overly aggressive low values from env
function clamp(n: number, min: number, max: number) { return Math.max(min, Math.min(max, n)); }
const S3_CONN_TIMEOUT = clamp(parseInt(process.env.S3_CONN_TIMEOUT || '20000', 10), 5000, 60000); // 5s..60s
const S3_REQ_TIMEOUT  = clamp(parseInt(process.env.S3_REQ_TIMEOUT  || '45000', 10), 30000, 120000); // 30s..120s
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

// -------------------- Search helpers --------------------
export type SearchItemType = 'file' | 'folder';
export interface SearchParams {
    q: string;
    type?: 'all' | 'files' | 'folders';
    limit?: number;
    fileTypes?: string[];
    dateStart?: string; // ISO date
    dateEnd?: string;   // ISO date
}

export interface SearchResultItem {
    key: string;
    type: SearchItemType;
    lastModified?: string;
}

function extToKind(name: string): string {
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (['pdf'].includes(ext)) return 'pdf';
    if (['png','jpg','jpeg','gif','svg','webp'].includes(ext)) return 'image';
    if (['mp4','mov','avi','mkv'].includes(ext)) return 'video';
    if (['mp3','wav','aac','flac'].includes(ext)) return 'audio';
    if (['xlsx','xls','csv'].includes(ext)) return 'spreadsheet';
    if (['docx','doc','txt','rtf','md'].includes(ext)) return 'document';
    if (['pptx','ppt','key'].includes(ext)) return 'presentation';
    return 'file';
}

const searchCache = new Map<string, { data: SearchResultItem[]; ts: number }>();
const SEARCH_CACHE_TTL = 30_000; // 30s

export async function searchInBucket(params: SearchParams): Promise<SearchResultItem[]> {
    const { q, type = 'all' } = params;
    const limit = Math.min(Math.max(params.limit || 100, 1), 500);
    const fileTypes = Array.isArray(params.fileTypes) ? params.fileTypes.map(s => String(s).toLowerCase()) : [];
    const dateStart = params.dateStart ? Date.parse(params.dateStart) : undefined;
    const dateEnd = params.dateEnd ? Date.parse(params.dateEnd) : undefined;
    const needle = String(q || '').toLowerCase().trim();
    if (!needle) return [];

    // Cache key ignoring limit so we can slice
    const cacheKey = JSON.stringify({ q: needle, type, fileTypes, dateStart, dateEnd });
    const now = Date.now();
    const cached = searchCache.get(cacheKey);
    if (cached && (now - cached.ts) < SEARCH_CACHE_TTL) {
        return cached.data.slice(0, limit);
    }

    // S3 scan with bounded work and early exit
    const results: SearchResultItem[] = [];
    const seen = new Set<string>();
    const scannedCap = 5000; // max objects to scan per request
    let scanned = 0;

    const prefixesToScan = ['/', ''];
    for (const pfx of prefixesToScan) {
        let continuationToken: string | undefined = undefined;
        do {
            const cmd = new ListObjectsV2Command({
                Bucket: bucket,
                Prefix: pfx,
                ContinuationToken: continuationToken,
                MaxKeys: 1000,
            } as any);
            const response: any = await s3Client.send(cmd);
            const contents: Array<{ Key: string; LastModified?: Date }> = (response.Contents || []).filter((o: any) => !!o.Key);

            for (const obj of contents) {
                const key = obj.Key || '';
                // Skip icons tree
                if (key.startsWith('icons/') || key.startsWith('/icons/')) continue;

                const isFolder = key.endsWith('/');
                const typeOk = (type === 'all') || (type === 'files' && !isFolder) || (type === 'folders' && isFolder);
                if (!typeOk) continue;

                // Match name by last segment
                const lastSegment = canonicalKey(key).split('/').pop() || '';
                if (!lastSegment.toLowerCase().includes(needle)) continue;

                // Filters
                if (!isFolder) {
                    if (fileTypes.length > 0) {
                        const kind = extToKind(lastSegment);
                        if (!fileTypes.includes(kind)) continue;
                    }
                    if (dateStart || dateEnd) {
                        const lm = obj.LastModified ? obj.LastModified.getTime() : undefined;
                        if (lm !== undefined) {
                            if (dateStart && lm < dateStart) continue;
                            if (dateEnd && lm > dateEnd) continue;
                        }
                    }
                }

                const keyForSet = key;
                if (!seen.has(keyForSet)) {
                    seen.add(keyForSet);
                    results.push({ key, type: isFolder ? 'folder' : 'file', lastModified: obj.LastModified?.toISOString() });
                }
                if (results.length >= limit) break;
            }

            scanned += contents.length;
            if (results.length >= limit || scanned >= scannedCap) break;
            continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
        } while (continuationToken);
        if (results.length >= limit || scanned >= scannedCap) break;
    }

    searchCache.set(cacheKey, { data: results.slice(0, 500), ts: now });
    return results.slice(0, limit);
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

export function canonicalKey(input: string): string {
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

export async function getSignedUploadUrl(path: string, contentType?: string): Promise<string> {
    const params: any = { Bucket: bucket, Key: path };
    if (contentType && typeof contentType === 'string') params.ContentType = contentType;
    const command = new PutObjectCommand(params);
    return await getSignedUrl(s3Client, command, { expiresIn: 3600 });
}

/** Invalidate icon cache entries for specific item paths */
export function invalidateIconCacheFor(paths: string[]) {
    for (const p of paths) {
        const key = canonicalKey(p);
        iconCache.delete(key);
        cacheTimestamps.delete(key);
    }
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

// Rename a single file/object by copying to new key and deleting the original
export async function renameFileExact(oldKey: string, newKey: string): Promise<void> {
    const src = String(oldKey);
    const dst = String(newKey);
    const enc = (k: string) => encodeURIComponent(k).replace(/%2F/g, '/');
    try {
        await s3Client.send(new CopyObjectCommand({
            Bucket: bucket,
            CopySource: `${bucket}/${enc(src)}`,
            Key: dst,
        }));
        await s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: src }));
    } catch (err) {
        console.error('Error renaming file:', src, '->', dst, err);
        throw err;
    }
}

/**
 * Rename one or more icon objects associated with an item path, preserving file extension.
 * If multiple icon formats exist, all will be moved.
 */
export async function renameIconsForItem(oldItemPath: string, newItemPath: string): Promise<{ renamed: number; attempts: Array<{ from: string; to: string; ok: boolean; error?: string }> }> {
    const exts = ['png', 'jpg', 'jpeg', 'gif', 'webp'];
    const enc = (k: string) => encodeURIComponent(k).replace(/%2F/g, '/');
    const attempts: Array<{ from: string; to: string; ok: boolean; error?: string }> = [];
    let renamed = 0;
    for (const ext of exts) {
        const fromKey = buildIconKey(oldItemPath, ext);
        try {
            // Probe existence first
            await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: fromKey }));
        } catch {
            // Not found, skip this ext
            continue;
        }
        const toKey = buildIconKey(newItemPath, ext);
        try {
            await s3Client.send(new CopyObjectCommand({ Bucket: bucket, CopySource: `${bucket}/${enc(fromKey)}`, Key: toKey }));
            await s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: fromKey }));
            attempts.push({ from: fromKey, to: toKey, ok: true });
            renamed++;
        } catch (e: any) {
            console.error('Error renaming icon:', fromKey, '->', toKey, e);
            attempts.push({ from: fromKey, to: toKey, ok: false, error: e?.message || String(e) });
        }
    }
    // Invalidate cache entries for both paths
    invalidateIconCacheFor([oldItemPath, newItemPath]);
    return { renamed, attempts };
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
    // Preserve leading slash if present (keys in this bucket appear to use it); ensure trailing slash
    let src = String(oldPrefix);
    let dst = String(newPrefix);
    if (!src.endsWith('/')) src += '/';
    if (!dst.endsWith('/')) dst += '/';
    const enc = (k: string) => encodeURIComponent(k).replace(/%2F/g, '/');

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
                    CopySource: `${bucket}/${enc(obj.Key)}`,
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

    console.log('[renameFolderExact] completed', { from: src, to: dst, moved, deleted });
    return { moved, deleted };
}
