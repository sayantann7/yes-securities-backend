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
const express_1 = require("express");
const aws_1 = require("./aws");
const router = (0, express_1.Router)();
router.get("/folders", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const prefix = req.body.prefix || "";
        const data = yield (0, aws_1.listChildren)(`${prefix}/`);
        res.json(data);
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to list children" });
    }
}));
router.get("/files", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const key = decodeURIComponent(req.body.key);
        const url = yield (0, aws_1.getSignedDownloadUrl)(key);
        res.json({ url });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to generate signed URL" });
    }
}));
exports.default = router;
