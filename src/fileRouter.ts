import { Router, Request, Response } from "express";
import { getSignedDownloadUrl, getSignedUploadUrl, listChildren, createFolder } from "./aws"

const router = Router();

router.post(
  "/folders",
  async (req: Request, res: Response) => {
    try {
      const prefix = req.body.prefix;
      let decodedPrefix = `${prefix}/`;
      if(prefix=="" || prefix.endsWith("/")){
        decodedPrefix = prefix;
      }
      const data = await listChildren(decodedPrefix);
      console.log(data);
      res.json(data);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to list children" });
    }
  }
);

router.post(
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

router.post(
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


//@ts-ignore
router.post('/folders/create', async (req: Request, res: Response) => {
  const { prefix = '', name } = req.body;

  const response = await createFolder(prefix, name);

  if (response=== void 0) {
    return res.status(400).json({ error: 'Folder name is required' });
  }

  const normalizedPrefix = prefix ? prefix.replace(/\/?$/, '/') : '';
  const folderKey = `${normalizedPrefix}${name.replace(/\/?$/, '')}/`;

  try {
    const response = await createFolder(prefix, name);
    return res.status(201).json({ message: 'Folder created', key: folderKey });
  } catch (err) {
    console.error('Error creating folder:', err);
    return res.status(500).json({ error: 'Failed to create folder' });
  }
});

export default router;