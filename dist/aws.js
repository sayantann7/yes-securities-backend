"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.listChildren = listChildren;
exports.getSignedDownloadUrl = getSignedDownloadUrl;
const client_s3_1 = require("@aws-sdk/client-s3");
const client_s3_2 = require("@aws-sdk/client-s3");
const s3_request_presigner_1 = require("@aws-sdk/s3-request-presigner");
require('dotenv').config();
const s3Client = new client_s3_2.S3Client({ region: 'ap-south-1' });
const bucket = 'my-bucket-1502';
function listChildren(prefix) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const data = new client_s3_1.ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            Delimiter: "/",
        });
        const response = yield s3Client.send(data);
        const folders = [];
        (_a = response.CommonPrefixes) === null || _a === void 0 ? void 0 : _a.forEach((prefix) => {
            folders.push(prefix.Prefix || "");
        });
        const files = [];
        (_b = response.Contents) === null || _b === void 0 ? void 0 : _b.forEach((content) => {
            files.push(content.Key || "");
        });
        return { folders, files };
    });
}
function getSignedDownloadUrl(path) {
    return __awaiter(this, void 0, void 0, function* () {
        let command = new client_s3_1.GetObjectCommand({ Bucket: bucket, Key: path });
        return yield (0, s3_request_presigner_1.getSignedUrl)(s3Client, command, { expiresIn: 3600 });
    });
}
