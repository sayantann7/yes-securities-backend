import { GetObjectCommand, PutObjectCommand, ListObjectsV2Command, CopyObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
require('dotenv').config();

// Configure S3 client with proper timeouts and connection limits
const s3Client = new S3Client({ 
    region: 'ap-south-1',
    requestHandler: {
        connectionTimeout: 10000, // 10 seconds
        requestTimeout: 30000,    // 30 seconds
    },
    maxAttempts: 3,
});

const bucket = process.env.S3_BUCKET_NAME;

// Cache for icon URLs to avoid repeated S3 calls
const iconCache = new Map<string, string | null>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const cacheTimestamps = new Map<string, number>();

export interface GetSignedUrlParams {
    path: string;
}

/**
 * Optimized icon URL retrieval with caching and concurrent processing
 */
export async function getCustomIconUrlOptimized(itemPath: string): Promise<string | null> {
    const cacheKey = itemPath;
    const now = Date.now();
    
    // Check cache first
    if (iconCache.has(cacheKey)) {
        const timestamp = cacheTimestamps.get(cacheKey) || 0;
        if (now - timestamp < CACHE_TTL) {
            return iconCache.get(cacheKey) || null;
        }
    }
    
    try {
        const iconKey = `icons/${itemPath.replace(/[^a-zA-Z0-9]/g, '_')}_icon`;
        const extensions = ['png', 'jpg', 'jpeg', 'gif', 'webp'];
        
        // Try all extensions concurrently instead of sequentially
        const iconChecks = extensions.map(async (ext) => {
            try {
                const fullIconKey = `${iconKey}.${ext}`;
                const command = new GetObjectCommand({ Bucket: bucket, Key: fullIconKey });
                await s3Client.send(command);
                return fullIconKey;
            } catch {
                return null;
            }
        });
        
        const results = await Promise.allSettled(iconChecks);
        const foundIcon = results.find(result => 
            result.status === 'fulfilled' && result.value
        );
        
        if (foundIcon && foundIcon.status === 'fulfilled' && foundIcon.value) {
            const iconUrl = await getSignedDownloadUrl(foundIcon.value);
            // Cache the result
            iconCache.set(cacheKey, iconUrl);
            cacheTimestamps.set(cacheKey, now);
            return iconUrl;
        } else {
            // Cache negative result
            iconCache.set(cacheKey, null);
            cacheTimestamps.set(cacheKey, now);
            return null;
        }
    } catch (err) {
        console.error('Error getting custom icon URL:', err);
        // Cache negative result on error
        iconCache.set(cacheKey, null);
        cacheTimestamps.set(cacheKey, now);
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

/**
 * Optimized list children with concurrent icon loading and limits
 */
export async function listChildrenWithIconsOptimized(prefix: string = '', maxItems: number = 1000) {
    const normalizedPrefix = typeof prefix === 'string' ? prefix : '';
    
    try {
        // Add MaxKeys to limit S3 response size
        const data = new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: normalizedPrefix,
            Delimiter: "/",
            MaxKeys: maxItems,
        });

        const response = await s3Client.send(data);

        // Collect all items first
        const allFolders: Array<{key: string}> = [];
        const allFiles: Array<{key: string}> = [];
        
        if (response.CommonPrefixes) {
            response.CommonPrefixes.forEach(prefixObj => {
                const folderKey = prefixObj.Prefix || "";
                allFolders.push({ key: folderKey });
            });
        }

        if (response.Contents) {
            response.Contents.forEach(content => {
                const fileKey = content.Key || "";
                if (!fileKey.endsWith('/') && !fileKey.startsWith('icons/')) {
                    allFiles.push({ key: fileKey });
                }
            });
        }

        // Get all item keys for batch icon processing
        const allItemKeys = [
            ...allFolders.map(f => f.key),
            ...allFiles.map(f => f.key)
        ];

        // Batch process icons with concurrency limit
        const iconResults = await batchProcessIcons(allItemKeys, 5); // Limit to 5 concurrent requests

        // Combine results
        const foldersWithIcons = allFolders.map(folder => ({
            key: folder.key,
            iconUrl: iconResults.get(folder.key) || undefined
        }));

        const filesWithIcons = allFiles.map(file => ({
            key: file.key,
            iconUrl: iconResults.get(file.key) || undefined
        }));

        return { 
            folders: foldersWithIcons, 
            files: filesWithIcons,
            isTruncated: response.IsTruncated || false,
            continuationToken: response.NextContinuationToken
        };
        
    } catch (error) {
        console.error('Error in listChildrenWithIconsOptimized:', error);
        throw error;
    }
}

/**
 * Simple list without icons for faster loading
 */
export async function listChildrenFast(prefix: string = '', maxItems: number = 1000) {
    const normalizedPrefix = typeof prefix === 'string' ? prefix : '';
    
    const data = new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: normalizedPrefix,
        Delimiter: "/",
        MaxKeys: maxItems,
    });

    const response = await s3Client.send(data);

    const folders: Array<{key: string}> = [];
    if (response.CommonPrefixes) {
        response.CommonPrefixes.forEach(prefixObj => {
            const folderKey = prefixObj.Prefix || "";
            folders.push({ key: folderKey });
        });
    }

    const files: Array<{key: string}> = [];
    if (response.Contents) {
        response.Contents.forEach(content => {
            const fileKey = content.Key || "";
            if (!fileKey.endsWith('/') && !fileKey.startsWith('icons/')) {
                files.push({ key: fileKey });
            }
        });
    }

    return { 
        folders, 
        files,
        isTruncated: response.IsTruncated || false,
        continuationToken: response.NextContinuationToken
    };
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

// Clear cache periodically
setInterval(() => {
    const now = Date.now();
    for (const [key, timestamp] of cacheTimestamps.entries()) {
        if (now - timestamp > CACHE_TTL) {
            iconCache.delete(key);
            cacheTimestamps.delete(key);
        }
    }
}, 60000); // Clean up every minute
