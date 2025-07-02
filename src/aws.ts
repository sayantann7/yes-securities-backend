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

    const folders: string[] = [];
    response.CommonPrefixes?.forEach((prefix) => {
        folders.push(prefix.Prefix || "");
    });

    const files: string[] = [];
    response.Contents?.forEach((content) => {
        files.push(content.Key || "");
    });

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
