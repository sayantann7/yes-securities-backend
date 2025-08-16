import { Router, Request, Response } from "express";
import { 
    listChildrenWithIconsOptimized, 
    listChildrenFast, 
    getSignedDownloadUrl, 
    getSignedUploadUrl, 
    createFolder, 
    deleteFolderRecursively, 
    getIconUploadUrl, 
    getCustomIconUrlOptimized, 
  deleteFile,
  renameFolderExact,
  renameFileExact
} from "./awsOptimized";
import { prisma } from "./prisma";
import jwt from "jsonwebtoken";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET;

// Helpers to normalize API inputs to S3-compatible prefixes/keys respecting your bucket layout
// Content lives under the "/" folder, icons live under "icons/" (no leading slash)
function normalizeSlashes(v: string) { return v.replace(/\\+/g, '/').replace(/\/\/+/, '/'); }

function toS3Prefix(input?: string): string {
  let p = (input || '').trim();
  p = normalizeSlashes(p);
  if (p === '') return '/'; // default to listing inside the "/" folder
  // If caller passed an icons path, leave as-is (we don't list icons here anyway)
  if (p.startsWith('icons/')) {
    if (!p.endsWith('/')) p += '/';
    return p;
  }
  // Ensure exactly one leading slash for content and one trailing slash
  if (!p.startsWith('/')) p = '/' + p;
  if (!p.endsWith('/')) p += '/';
  return p;
}

function toS3Key(input: string): string {
  let k = (input || '').trim();
  k = normalizeSlashes(k);
  // Icons must not start with a leading slash
  if (k.startsWith('/icons/')) k = k.slice(1);
  if (k.startsWith('icons/')) return k;
  // Content must start with a single leading slash
  if (!k.startsWith('/')) k = '/' + k;
  return k;
}

// Enhanced cache for bookmark queries with better performance
interface CacheItem<T> {
    data: T;
    timestamp: number;
}

const bookmarkCache = new Map<string, CacheItem<any[]>>();
const BOOKMARK_CACHE_TTL = 2 * 60 * 1000; // 2 minutes
const BOOKMARK_CACHE_MAX_ENTRIES = 5000; // safety cap to prevent unbounded growth

function enforceBookmarkCacheLimit() {
    if (bookmarkCache.size <= BOOKMARK_CACHE_MAX_ENTRIES) return;
    const entries: Array<{ key: string; ts: number }> = [];
    for (const [key, item] of bookmarkCache.entries()) entries.push({ key, ts: item.timestamp });
    entries.sort((a, b) => a.ts - b.ts); // oldest first
    const toEvict = bookmarkCache.size - BOOKMARK_CACHE_MAX_ENTRIES;
    for (let i = 0; i < toEvict; i++) bookmarkCache.delete(entries[i].key);
}

async function getCachedBookmarks(userId: string): Promise<any[]> {
    const now = Date.now();
    const cacheKey = userId;
    
    // Check cache first
    const cached = bookmarkCache.get(cacheKey);
    if (cached && (now - cached.timestamp) < BOOKMARK_CACHE_TTL) {
        return cached.data;
    }
    
    // Fetch from database with error handling
    try {
        const userBookmarks = await prisma.bookmark.findMany({
            where: { userId },
            select: { itemId: true, itemName: true, itemType: true, createdAt: true }
        });
        bookmarkCache.set(cacheKey, { data: userBookmarks, timestamp: now });
        enforceBookmarkCacheLimit();
        return userBookmarks;
    } catch (error) {
        console.error('Error fetching bookmarks:', error);
        if (cached) return cached.data;
        return [];
    }
}

// List with optional icons
router.post(
  "/folders",
  async (req: Request, res: Response) => {
    try {
        const prefixRaw = req.body.prefix as string | undefined;
        const loadIcons = req.body.loadIcons !== false; // Default to true
        const maxItems = parseInt(req.body.maxItems) || 500; // Limit items per request

        // Auth (optional) to fetch bookmarks
        const authHeader = req.headers.authorization;
        let userId: string | null = null;
        if (authHeader && authHeader.startsWith('Bearer ') && JWT_SECRET) {
            try {
                const token = authHeader.split(" ")[1];
                const decoded = jwt.verify(token, JWT_SECRET as string) as any;
                userId = decoded.userId;
            } catch {}
        }

        // Normalize prefix: when empty, list inside "/"
        const s3Prefix = toS3Prefix(typeof prefixRaw === 'string' ? prefixRaw : '');

        const data = loadIcons 
            ? await listChildrenWithIconsOptimized(s3Prefix, Math.min(maxItems, 500))
            : await listChildrenFast(s3Prefix, Math.min(maxItems, 1000));

        // Filter: never show the synthetic root "/" or anything under icons/
        const filteredFolders = (data.folders || []).filter(f => {
          const k = f.key || '';
          if (k === '/' || k === 'icons/' || k.startsWith('icons/')) return false;
          return true;
        });
        const filteredFiles = (data.files || []).filter(f => {
          const k = f.key || '';
          return !k.startsWith('icons/');
        });

        let foldersOut = filteredFolders;
        let filesOut = filteredFiles;

        // Bookmarks (optional)
        if (userId) {
          const userBookmarks = await getCachedBookmarks(userId);
          const bookmarkedDocumentIds = new Set(
              userBookmarks.filter((b: any) => b.itemType === 'document').map((b: any) => b.itemId)
          );
          const bookmarkedFolderIds = new Set(
              userBookmarks.filter((b: any) => b.itemType === 'folder').map((b: any) => b.itemId)
          );
          foldersOut = foldersOut.map(folder => ({
            ...folder,
            isBookmarked: bookmarkedFolderIds.has(folder.key)
          }));
          filesOut = filesOut.map(file => ({
            ...file,
            isBookmarked: bookmarkedDocumentIds.has(file.key)
          }));
        }

        res.json({
            folders: foldersOut,
            files: filesOut,
            isTruncated: data.isTruncated || false,
            continuationToken: data.continuationToken || null,
            totalItems: foldersOut.length + filesOut.length
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
        const prefixRaw = req.body.prefix as string | undefined;
        const maxItems = parseInt(req.body.maxItems) || 1000;
        
        // Normalize prefix for content root
        const s3Prefix = toS3Prefix(typeof prefixRaw === 'string' ? prefixRaw : '');
        const data = await listChildrenFast(s3Prefix, maxItems);
        
        const filteredFolders = (data.folders || []).filter(f => {
          const k = f.key || '';
          return k !== '/' && k !== 'icons/' && !k.startsWith('icons/');
        });
        const filteredFiles = (data.files || []).filter(f => !(f.key || '').startsWith('icons/'));
        
        res.json({
            folders: filteredFolders,
            files: filteredFiles,
            isTruncated: data.isTruncated || false,
            continuationToken: data.continuationToken || null,
            totalItems: filteredFolders.length + filteredFiles.length
        });
        
    } catch (err) {
        console.error('Error in /folders/fast endpoint:', err);
        res.status(500).json({ error: "Failed to list children" });
    }
  }
);

// Get signed URL for file download
router.post(
  "/files/fetch",
  async (req: Request, res: Response) => {
    try {
      const { key: keyRaw } = req.body || {};
      if (!keyRaw || typeof keyRaw !== 'string') { res.status(400).json({ error: 'key is required' }); return; }
      const key = toS3Key(decodeURIComponent(keyRaw));
      const url = await getSignedDownloadUrl(key);
      res.json({ url });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to generate signed URL" });
    }
  }
);

// Get signed URL for file upload
router.post(
  "/files/upload",
  async (req: Request, res: Response) => {
    try {
  const { key: keyRaw, contentType } = req.body || {};
      if (!keyRaw || typeof keyRaw !== 'string') { res.status(400).json({ error: 'key is required' }); return; }
      const key = toS3Key(decodeURIComponent(keyRaw));
  const url = await getSignedUploadUrl(key, typeof contentType === 'string' ? contentType : undefined);
      res.json({ url });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to generate signed URL" });
    }
  }
);

// Delete a single file (accepts either { filePath } or { key })
router.delete('/files/delete', async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const provided = typeof body.filePath === 'string' && body.filePath.trim() !== ''
      ? body.filePath
      : (typeof body.key === 'string' ? body.key : undefined);

    if (!provided) {
      res.status(400).json({ error: 'File path is required' });
      return;
    }

    let decoded = provided;
    try { decoded = decodeURIComponent(provided); } catch {
      // keep as-is if it's not URI-encoded
    }

    const primary = toS3Key(decoded);
    const variants = new Set<string>([primary]);
    const noSlash = primary.replace(/^\/+/, '');
    variants.add(noSlash);          // without leading slash
    variants.add('/' + noSlash);    // with single leading slash

    // Try delete across variants to be robust to stored key format
    const attempts: Array<{ key: string; ok: boolean; error?: any }> = [];
    for (const k of variants) {
      try {
        await deleteFile(k);
        attempts.push({ key: k, ok: true });
      } catch (e) {
        attempts.push({ key: k, ok: false, error: (e as any)?.message });
      }
    }

    // Optional: clear bookmark cache since a document may be removed
    bookmarkCache.clear();

    res.json({ message: 'File delete attempted', attempts: Array.from(attempts) });
  } catch (err) {
    console.error('Error deleting file:', err);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

// Rename a single file (PUT /api/files/rename)
router.put('/files/rename', async (req: Request, res: Response) => {
  try {
    const { oldPath, newName } = req.body || {};
    if (!oldPath || !newName || typeof oldPath !== 'string' || typeof newName !== 'string') {
      res.status(400).json({ error: 'Old path and new name are required' });
      return;
    }
    // Decode URI components if needed
    let decodedOld = oldPath;
    try { decodedOld = decodeURIComponent(oldPath); } catch {}
    const oldKey = toS3Key(decodedOld);
    // Build new key in the same folder
    const parts = oldKey.split('/');
    const fileName = parts.pop(); // old filename
    const dir = parts.join('/') + (parts.length ? '/' : '');
    const newKey = toS3Key(dir + newName);
    await renameFileExact(oldKey, newKey);
    res.json({ message: 'File renamed', from: oldKey, to: newKey });
  } catch (err) {
    console.error('Error renaming file:', err);
    res.status(500).json({ error: 'Failed to rename file' });
  }
});

// Create folder
router.post('/folders/create', async (req: Request, res: Response) => {
  try {
    const { prefix = '', name } = req.body || {};
    if (!name || typeof name !== 'string' || name.trim() === '') {
      res.status(400).json({ error: 'Folder name is required' });
      return;
    }
    const s3Prefix = toS3Prefix(typeof prefix === 'string' ? prefix : '');
    const safeName = String(name).trim().replace(/\/?$/, '');
    const folderKey = `${s3Prefix}${safeName}/`;

    await createFolder(s3Prefix, safeName);
    bookmarkCache.clear();

    res.status(201).json({ message: 'Folder created', key: folderKey });
  } catch (err) {
    console.error('Error creating folder:', err);
    res.status(500).json({ error: 'Failed to create folder' });
  }
});

// Delete folder recursively (accepts either { folderPath } or { prefix, name })
router.delete('/folders/delete', async (req: Request, res: Response) => {
  try {
    const { folderPath, prefix, name } = req.body || {};
    let folderKey: string | null = null;
    if (typeof folderPath === 'string' && folderPath.trim() !== '') {
      folderKey = toS3Prefix(folderPath).replace(/\/$/, '/') ;
    } else if (typeof name === 'string' && name.trim() !== '') {
      const s3Prefix = toS3Prefix(typeof prefix === 'string' ? prefix : '');
      const safeName = String(name).trim().replace(/\/?$/, '');
      folderKey = `${s3Prefix}${safeName}/`;
    }
    if (!folderKey) { res.status(400).json({ error: 'Folder path or name is required' }); return; }

    await deleteFolderRecursively(folderKey);
    bookmarkCache.clear();

    res.json({ message: 'Folder deleted', key: folderKey });
  } catch (err) {
    console.error('Error deleting folder:', err);
    res.status(500).json({ error: 'Failed to delete folder' });
  }
});

// Icon upload URL
router.post('/icons/upload', async (req: Request, res: Response) => {
  try {
    const { itemPath, iconType = 'png' } = req.body || {};
    if (!itemPath || typeof itemPath !== 'string') { res.status(400).json({ error: 'itemPath is required' }); return; }
    const uploadUrl = await getIconUploadUrl(itemPath, iconType);
    res.json({ uploadUrl });
  } catch (err) {
    console.error('Error generating icon upload URL:', err);
    res.status(500).json({ error: 'Failed to get upload URL' });
  }
});

// Get icon URL for a file or folder
router.get('/icons/:encodedPath', async (req: Request, res: Response) => {
  try {
    const encoded = req.params.encodedPath;
    const itemPath = decodeURIComponent(encoded);
    const iconUrl = await getCustomIconUrlOptimized(itemPath);
    if (!iconUrl) { res.status(404).json({ iconUrl: undefined }); return; }
    res.json({ iconUrl });
  } catch (err) {
    console.error('Error fetching icon URL:', err);
    res.status(500).json({ error: 'Failed to fetch icon' });
  }
});

// Rename folder
router.put('/folders/rename', async (req: Request, res: Response) => {
  try {
    const { oldPath, newName } = req.body || {};
    if (!oldPath || !newName || typeof oldPath !== 'string' || typeof newName !== 'string') {
      res.status(400).json({ error: 'Old path and new name are required' });
      return;
    }

    // Decode and normalize
    let decodedOld = oldPath;
    try { decodedOld = decodeURIComponent(oldPath); } catch {}

    // Normalize source prefix (content lives under leading '/')
    let srcPrefix = toS3Prefix(decodedOld.replace(/^icons\//, ''));
    // Build destination prefix in same parent directory
    const parts = srcPrefix.replace(/^\/+/, '').split('/').filter(Boolean);
    parts.pop();
    const dstPrefix = toS3Prefix((parts.length ? '/' + parts.join('/') : '/') + '/' + newName);

    const result = await renameFolderExact(
      srcPrefix.replace(/^\/+/, ''),
      dstPrefix.replace(/^\/+/, '')
    );

    // Clear caches
    bookmarkCache.clear();

    res.json({ message: 'Folder renamed', from: srcPrefix, to: dstPrefix, ...result });
  } catch (err) {
    console.error('Error renaming folder:', err);
    res.status(500).json({ error: 'Failed to rename folder' });
  }
});

export default router;
