import { Router, Request, Response } from "express";
import { 
    getSignedDownloadUrl, 
    getSignedUploadUrl, 
    createFolder, 
    listChildrenWithIconsOptimized, 
    listChildrenFast 
} from "./awsOptimized";
import { prisma } from "./prisma";
import jwt from "jsonwebtoken";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET;

// Cache for bookmark queries
const bookmarkCache = new Map<string, any[]>();
const BOOKMARK_CACHE_TTL = 2 * 60 * 1000; // 2 minutes
const bookmarkCacheTimestamps = new Map<string, number>();

async function getCachedBookmarks(userId: string): Promise<any[]> {
    const now = Date.now();
    const cacheKey = userId;
    
    // Check cache first
    if (bookmarkCache.has(cacheKey)) {
        const timestamp = bookmarkCacheTimestamps.get(cacheKey) || 0;
        if (now - timestamp < BOOKMARK_CACHE_TTL) {
            return bookmarkCache.get(cacheKey) || [];
        }
    }
    
    // Fetch from database
    try {
        const userBookmarks = await prisma.bookmark.findMany({
            where: { userId },
            select: {
                itemId: true,
                itemName: true,
                itemType: true,
                createdAt: true,
            }
        });
        
        // Cache the result
        bookmarkCache.set(cacheKey, userBookmarks);
        bookmarkCacheTimestamps.set(cacheKey, now);
        
        return userBookmarks;
    } catch (error) {
        console.error('Error fetching bookmarks:', error);
        return [];
    }
}

router.post(
  "/folders",
  async (req: Request, res: Response) => {
    try {
        const prefix = req.body.prefix;
        const loadIcons = req.body.loadIcons !== false; // Default to true
        const maxItems = parseInt(req.body.maxItems) || 500; // Limit items per request
        
        // Check for authentication token
        const authHeader = req.headers.authorization;
        let userId = null;
        
        if (authHeader) {
            const token = authHeader.split(" ")[1];
            if (token) {
                try {
                    const decoded = jwt.verify(token, JWT_SECRET as string) as any;
                    userId = decoded.userId;
                } catch (error) {
                    console.log('Invalid token provided');
                }
            }
        }
        
        let decodedPrefix = '';
        if (prefix && typeof prefix === 'string' && prefix.trim() !== '') {
            decodedPrefix = prefix.endsWith('/') ? prefix : `${prefix}/`;
        }
        
        // Use optimized or fast listing based on loadIcons flag
        const data = loadIcons 
            ? await listChildrenWithIconsOptimized(decodedPrefix, maxItems)
            : await listChildrenFast(decodedPrefix, maxItems);
        
        // Handle bookmarks concurrently with S3 operations
        let bookmarkPromise: Promise<any[]> = Promise.resolve([]);
        if (userId) {
            bookmarkPromise = getCachedBookmarks(userId);
        }
        
        const userBookmarks = await bookmarkPromise;
        
        // Create sets for quick lookup
        const bookmarkedDocumentIds = new Set(
            userBookmarks.filter((b: any) => b.itemType === 'document').map((b: any) => b.itemId)
        );
        const bookmarkedFolderIds = new Set(
            userBookmarks.filter((b: any) => b.itemType === 'folder').map((b: any) => b.itemId)
        );
        
        // Add isBookmarked property
        const foldersWithBookmarks = data.folders.map(folder => ({
            ...folder,
            isBookmarked: userId ? bookmarkedFolderIds.has(folder.key) : false
        }));
        
        const filesWithBookmarks = data.files.map(file => ({
            ...file,
            isBookmarked: userId ? bookmarkedDocumentIds.has(file.key) : false
        }));
        
        res.json({
            folders: foldersWithBookmarks,
            files: filesWithBookmarks,
            isTruncated: data.isTruncated || false,
            continuationToken: data.continuationToken || null,
            totalItems: data.folders.length + data.files.length
        });
        
    } catch (err) {
        console.error('Error in /folders endpoint:', err);
        res.status(500).json({ error: "Failed to list children" });
    }
  }
);

// Fast endpoint without icons for quick navigation
router.post(
  "/folders/fast",
  async (req: Request, res: Response) => {
    try {
        const prefix = req.body.prefix;
        const maxItems = parseInt(req.body.maxItems) || 1000;
        
        let decodedPrefix = '';
        if (prefix && typeof prefix === 'string' && prefix.trim() !== '') {
            decodedPrefix = prefix.endsWith('/') ? prefix : `${prefix}/`;
        }
        
        const data = await listChildrenFast(decodedPrefix, maxItems);
        
        res.json({
            folders: data.folders,
            files: data.files,
            isTruncated: data.isTruncated || false,
            continuationToken: data.continuationToken || null,
            totalItems: data.folders.length + data.files.length
        });
        
    } catch (err) {
        console.error('Error in /folders/fast endpoint:', err);
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

    const normalizedPrefix = prefix && typeof prefix === 'string' ? 
      (prefix.endsWith('/') ? prefix : `${prefix}/`) : '';
    
    const folderKey = `${normalizedPrefix}${name.replace(/\/?$/, '')}/`;

    await createFolder(normalizedPrefix, name.trim());
    
    // Clear relevant caches
    bookmarkCache.clear();
    bookmarkCacheTimestamps.clear();
    
    return res.status(201).json({ message: 'Folder created', key: folderKey });
  } catch (err) {
    console.error('Error creating folder:', err);
    return res.status(500).json({ error: 'Failed to create folder' });
  }
});

// Clear caches periodically
setInterval(() => {
    const now = Date.now();
    
    // Clear bookmark cache
    for (const [key, timestamp] of bookmarkCacheTimestamps.entries()) {
        if (now - timestamp > BOOKMARK_CACHE_TTL) {
            bookmarkCache.delete(key);
            bookmarkCacheTimestamps.delete(key);
        }
    }
}, 60000); // Clean up every minute

export default router;
