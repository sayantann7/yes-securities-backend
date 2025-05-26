import express from "express";
import { downloadS3Folder } from "./aws";

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", async (req, res) => {
    try {
        // Download the S3 folder
        await downloadS3Folder("vercel");
        res.send("Files downloaded and copied successfully.");
    } catch (error) {
        console.error("Error:", error);
        res.status(500).send("An error occurred while processing your request.");
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});