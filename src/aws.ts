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
	let command = new PutObjectCommand({ Bucket: bucket, Key:path });
	return await getSignedUrl(s3Client, command, { expiresIn: 3600 });
}