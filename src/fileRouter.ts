import { Router, Request, Response } from "express";
import { getSignedDownloadUrl, getSignedUploadUrl, listChildren, createFolder, renameFile, deleteFile, renameFolder, deleteFolder, uploadCustomIcon, listChildrenWithIcons } from "./aws"

const router = Router();

router.post(
  "/folders",
  async (req: Request, res: Response) => {
    try {
      const prefix = req.body.prefix;
      let decodedPrefix = '';
      
      // Handle undefined, null, or empty prefix
      if (prefix && typeof prefix === 'string' && prefix.trim() !== '') {
        decodedPrefix = prefix.endsWith('/') ? prefix : `${prefix}/`;
      }
      
      const data = await listChildrenWithIcons(decodedPrefix);
      res.json(data);
    } catch (err) {
      console.error('Error in /folders endpoint:', err);
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
  try {
    const { prefix = '', name } = req.body;

    if (!name || typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ error: 'Folder name is required' });
    }

    // Normalize prefix
    const normalizedPrefix = prefix && typeof prefix === 'string' ? 
      (prefix.endsWith('/') ? prefix : `${prefix}/`) : '';
    
    const folderKey = `${normalizedPrefix}${name.replace(/\/?$/, '')}/`;

    await createFolder(normalizedPrefix, name.trim());
    return res.status(201).json({ message: 'Folder created', key: folderKey });
  } catch (err) {
    console.error('Error creating folder:', err);
    return res.status(500).json({ error: 'Failed to create folder' });
  }
});

// @ts-ignore
router.put('/files/rename', async (req: Request, res: Response) => {
  try {
    const { oldPath, newName } = req.body;
    
    if (!oldPath || !newName) {
      return res.status(400).json({ error: 'Old path and new name are required' });
    }

    // Get the directory path from the old path
    const pathParts = oldPath.split('/');
    pathParts.pop(); // Remove the filename
    const dirPath = pathParts.length > 0 ? pathParts.join('/') + '/' : '';
    
    // Create the new full path
    const newPath = `${dirPath}${newName}`;
    
    await renameFile(oldPath, newPath);
    res.json({ message: 'File renamed successfully', newPath });
  } catch (err) {
    console.error('Error renaming file:', err);
    res.status(500).json({ error: 'Failed to rename file' });
  }
});

// @ts-ignore
router.delete('/files/delete', async (req: Request, res: Response) => {
  try {
    const { filePath } = req.body;
    
    if (!filePath) {
      return res.status(400).json({ error: 'File path is required' });
    }
    
    await deleteFile(filePath);
    res.json({ message: 'File deleted successfully' });
  } catch (err) {
    console.error('Error deleting file:', err);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

// @ts-ignore
router.put('/folders/rename', async (req: Request, res: Response) => {
  try {
    const { oldPath, newName } = req.body;
    
    if (!oldPath || !newName) {
      return res.status(400).json({ error: 'Old path and new name are required' });
    }
    
    await renameFolder(oldPath, newName);
    res.json({ message: 'Folder renamed successfully' });
  } catch (err) {
    console.error('Error renaming folder:', err);
    res.status(500).json({ error: 'Failed to rename folder' });
  }
});

// @ts-ignore
router.delete('/folders/delete', async (req: Request, res: Response) => {
  try {
    const { folderPath } = req.body;
    
    if (!folderPath) {
      return res.status(400).json({ error: 'Folder path is required' });
    }
    
    await deleteFolder(folderPath);
    res.json({ message: 'Folder deleted successfully' });
  } catch (err) {
    console.error('Error deleting folder:', err);
    res.status(500).json({ error: 'Failed to delete folder' });
  }
});

// @ts-ignore
router.post('/icons/upload', async (req: Request, res: Response) => {
  try {
    const { itemPath, iconType = 'jpeg' } = req.body;
    
    if (!itemPath) {
      return res.status(400).json({ error: 'Item path is required' });
    }
    
    const iconUrl = await uploadCustomIcon(itemPath, iconType);
    res.json({ iconUrl });
  } catch (err) {
    console.error('Error uploading icon:', err);
    res.status(500).json({ error: 'Failed to upload custom icon' });
  }
});

export default router;