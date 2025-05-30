import { Router, Request, Response } from "express";
import { getSignedDownloadUrl, getSignedUploadUrl, listChildren } from "./aws";

const router = Router();

router.get(
  "/folders",
  async (req: Request, res: Response) => {
    try {
      const prefix = req.body.prefix;
      let decodedPrefix = `${prefix}/`;
      if(prefix=="" || prefix.endsWith("/")){
        decodedPrefix = prefix;
      }
      const data = await listChildren(decodedPrefix);
      res.json(data);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to list children" });
    }
  }
);

router.get(
  "/files/fetch",
  async (req: Request, res: Response) => {
    try {
      const key = decodeURIComponent(req.body.key);
      const url = await getSignedDownloadUrl(key);
      res.json({ url });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to generate signed URL" });
    }
  }
);

router.get(
  "/files/upload",
  async (req: Request, res: Response) => {
    try {
      const key = decodeURIComponent(req.body.key);
      const url = await getSignedUploadUrl(key);
      res.json({ url });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to generate signed URL" });
    }
  }
);

export default router;