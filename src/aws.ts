import { GetObjectCommand, PutObjectCommand, ListObjectsV2Command, CopyObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
require('dotenv').config();

const s3Client = new S3Client({ region: 'ap-south-1' });
const bucket = process.env.S3_BUCKET_NAME;

export interface GetSignedUrlParams {
    path: string;
}

export async function listChildren(prefix: string) {

    const data = new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        Delimiter: "/",
    });

    const response = await s3Client.send(data);

    const folders: Array<{ path: string; iconUrl?: string }> = [];
    if (response.CommonPrefixes) {
        for (const prefixItem of response.CommonPrefixes) {
            const folderPath = prefixItem.Prefix || "";
            const iconUrl = await getCustomIconUrl(folderPath);
            folders.push({ path: folderPath, iconUrl: iconUrl || undefined });
        }
    }

    const files: Array<{ path: string; iconUrl?: string }> = [];
    if (response.Contents) {
        for (const content of response.Contents) {
            const filePath = content.Key || "";
            // Skip the folder placeholder files and icon files
            if (!filePath.endsWith('/') && !filePath.startsWith('icons/')) {
                const iconUrl = await getCustomIconUrl(filePath);
                files.push({ path: filePath, iconUrl: iconUrl || undefined });
            }
        }
    }

    return { folders, files };
}

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

    // ensure prefix ends with slash if non‐empty
    const normalizedPrefix = prefix ? prefix.replace(/\/?$/, '/') : '';
    const folderKey = `${normalizedPrefix}${name.replace(/\/?$/, '')}/`;

    try {
        await s3Client.send(new PutObjectCommand({
            Bucket: bucket,
            Key: folderKey,
            Body: '',         // zero‐byte object to represent folder
            ContentType: 'application/x-directory'
        }));
        return Promise.resolve();
    } catch (err) {
        console.error('Error creating folder:', err);
        return void Promise.reject(new Error('Failed to create folder'));
    }
}

/**
 * Create a folder with optional custom icon
 */
export async function createFolderWithIcon(prefix: string, name: string, iconData?: Buffer, iconType?: string): Promise<{ folderKey: string, iconUrl?: string }> {
    if (typeof name !== 'string' || name.trim() === '') {
        throw new Error('Folder name is required');
    }

    // ensure prefix ends with slash if non‐empty
    const normalizedPrefix = prefix ? prefix.replace(/\/?$/, '/') : '';
    const folderKey = `${normalizedPrefix}${name.replace(/\/?$/, '')}/`;

    try {
        // Create the folder
        await s3Client.send(new PutObjectCommand({
            Bucket: bucket,
            Key: folderKey,
            Body: '',
            ContentType: 'application/x-directory'
        }));

        let iconUrl: string | undefined;

        // Upload icon if provided
        if (iconData && iconType) {
            const iconKey = `icons/${folderKey.replace(/[^a-zA-Z0-9]/g, '_')}_icon.${iconType}`;
            
            await s3Client.send(new PutObjectCommand({
                Bucket: bucket,
                Key: iconKey,
                Body: iconData,
                ContentType: `image/${iconType}`
            }));

            iconUrl = `https://${bucket}.s3.ap-south-1.amazonaws.com/${iconKey}`;
        }

        return { folderKey, iconUrl };
    } catch (err) {
        console.error('Error creating folder with icon:', err);
        throw new Error('Failed to create folder');
    }
}

/**
 * Rename a file in S3 by copying to new location and deleting original
 */
export async function renameFile(oldKey: string, newKey: string): Promise<void> {
    try {
        // Copy the file to the new location
        await s3Client.send(new CopyObjectCommand({
            Bucket: bucket,
            CopySource: `${bucket}/${oldKey}`,
            Key: newKey
        }));

        // Delete the original file
        await s3Client.send(new DeleteObjectCommand({
            Bucket: bucket,
            Key: oldKey
        }));

        return Promise.resolve();
    } catch (err) {
        console.error('Error renaming file:', err);
        return void Promise.reject(new Error('Failed to rename file'));
    }
}

/**
 * Rename a folder by copying all contents to new prefix and deleting original
 */
export async function renameFolder(oldPrefix: string, newName: string): Promise<void> {
    try {
        // Ensure oldPrefix ends with /
        const normalizedOldPrefix = oldPrefix.endsWith('/') ? oldPrefix : `${oldPrefix}/`;
        
        // Get parent directory from old prefix
        const pathParts = normalizedOldPrefix.slice(0, -1).split('/');
        pathParts.pop(); // Remove the folder name
        const parentPrefix = pathParts.length > 0 ? pathParts.join('/') + '/' : '';
        
        // Create new prefix
        const newPrefix = `${parentPrefix}${newName}/`;

        // List all objects with the old prefix
        const listCommand = new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: normalizedOldPrefix,
        });

        const response = await s3Client.send(listCommand);
        
        if (response.Contents) {
            // Copy each object to the new location
            for (const object of response.Contents) {
                if (object.Key) {
                    const relativePath = object.Key.substring(normalizedOldPrefix.length);
                    const newKey = `${newPrefix}${relativePath}`;
                    
                    // Copy object
                    await s3Client.send(new CopyObjectCommand({
                        Bucket: bucket,
                        CopySource: `${bucket}/${object.Key}`,
                        Key: newKey
                    }));
                    
                    // Delete original object
                    await s3Client.send(new DeleteObjectCommand({
                        Bucket: bucket,
                        Key: object.Key
                    }));
                }
            }
        }

        return Promise.resolve();
    } catch (err) {
        console.error('Error renaming folder:', err);
        return void Promise.reject(new Error('Failed to rename folder'));
    }
}

/**
 * Delete a file from S3
 */
export async function deleteFile(key: string): Promise<void> {
    try {
        await s3Client.send(new DeleteObjectCommand({
            Bucket: bucket,
            Key: key
        }));
        return Promise.resolve();
    } catch (err) {
        console.error('Error deleting file:', err);
        return void Promise.reject(new Error('Failed to delete file'));
    }
}

/**
 * Delete a folder and all its contents from S3
 */
export async function deleteFolder(prefix: string): Promise<void> {
    try {
        // Ensure prefix ends with /
        const normalizedPrefix = prefix.endsWith('/') ? prefix : `${prefix}/`;

        // List all objects with this prefix
        const listCommand = new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: normalizedPrefix,
        });

        const response = await s3Client.send(listCommand);
        
        if (response.Contents) {
            // Delete each object
            for (const object of response.Contents) {
                if (object.Key) {
                    await s3Client.send(new DeleteObjectCommand({
                        Bucket: bucket,
                        Key: object.Key
                    }));
                }
            }
        }

        return Promise.resolve();
    } catch (err) {
        console.error('Error deleting folder:', err);
        return void Promise.reject(new Error('Failed to delete folder'));
    }
}

/**
 * Generate a signed URL for uploading a custom icon for a file or folder
 */
export async function uploadCustomIcon(itemPath: string, iconType: string): Promise<string> {
    try {
        // Create a unique icon path based on the item path
        const iconKey = `icons/${itemPath.replace(/[^a-zA-Z0-9]/g, '_')}_icon.${iconType}`;
        
        console.log('uploadCustomIcon Debug:', {
            originalPath: itemPath,
            iconType: iconType,
            generatedKey: iconKey
        });
        
        // Generate signed URL for uploading the icon
        const command = new PutObjectCommand({ 
            Bucket: bucket, 
            Key: iconKey,
            ContentType: `image/${iconType}`
        });
        
        const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
        console.log('Generated signed URL for icon upload:', signedUrl);
        return signedUrl;
    } catch (err) {
        console.error('Error generating icon upload URL:', err);
        throw new Error('Failed to generate icon upload URL');
    }
}

/**
 * Get the icon URL for a file or folder
 */
export async function getCustomIconUrl(itemPath: string): Promise<string | null> {
    try {
        const iconKey = `icons/${itemPath.replace(/[^a-zA-Z0-9]/g, '_')}_icon`;
        
        console.log('getCustomIconUrl Debug:', {
            originalPath: itemPath,
            sanitizedKey: iconKey
        });
        
        // Check if any icon exists with common extensions
        const extensions = ['png', 'jpg', 'jpeg', 'gif', 'webp'];
        
        for (const ext of extensions) {
            try {
                const fullIconKey = `${iconKey}.${ext}`;
                console.log(`Checking icon: ${fullIconKey}`);
                
                const command = new GetObjectCommand({ Bucket: bucket, Key: fullIconKey });
                await s3Client.send(command);
                
                // If we get here, the icon exists, return a signed URL instead of public URL
                const iconUrl = await getSignedDownloadUrl(fullIconKey);
                console.log(`Found icon, generated signed URL: ${iconUrl}`);
                return iconUrl;
            } catch (err) {
                // Icon with this extension doesn't exist, try next
                console.log(`Icon not found for extension ${ext}: ${iconKey}.${ext}`);
                continue;
            }
        }
        
        console.log(`No icon found for path: ${itemPath}`);
        return null; // No icon found
    } catch (err) {
        console.error('Error getting custom icon URL:', err);
        return null;
    }
}

/**
 * Update listChildren to include icon URLs
 */
export async function listChildrenWithIcons(prefix: string = '') {
    // Ensure prefix is a string and handle empty case
    const normalizedPrefix = typeof prefix === 'string' ? prefix : '';
    
    const data = new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: normalizedPrefix,
        Delimiter: "/",
    });

    const response = await s3Client.send(data);

    const folders: Array<{key: string, iconUrl?: string}> = [];
    if (response.CommonPrefixes) {
        for (const prefixObj of response.CommonPrefixes) {
            const folderKey = prefixObj.Prefix || "";
            const iconUrl = await getCustomIconUrl(folderKey);
            folders.push({ key: folderKey, iconUrl: iconUrl || undefined });
        }
    }

    const files: Array<{key: string, iconUrl?: string}> = [];
    if (response.Contents) {
        for (const content of response.Contents) {
            const fileKey = content.Key || "";
            // Skip the empty folder marker files and icon files
            if (!fileKey.endsWith('/') && !fileKey.startsWith('icons/')) {
                const iconUrl = await getCustomIconUrl(fileKey);
                files.push({ key: fileKey, iconUrl: iconUrl || undefined });
            }
        }
    }

    return { folders, files };
}
