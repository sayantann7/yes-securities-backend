import { GetObjectCommand, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
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