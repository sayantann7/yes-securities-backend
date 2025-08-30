import { prisma } from "./prisma";
import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { HeadObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { Agent as HttpAgent } from 'http';
import { Agent as HttpsAgent } from 'https';
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET;

// Create S3 client for bookmark validation
function clamp(n: number, min: number, max: number) { return Math.max(min, Math.min(max, n)); }
const S3_CONN_TIMEOUT = clamp(parseInt(process.env.S3_CONN_TIMEOUT || '20000', 10), 5000, 60000);
const S3_REQ_TIMEOUT = clamp(parseInt(process.env.S3_REQ_TIMEOUT || '45000', 10), 30000, 120000);
const S3_MAX_ATTEMPTS = parseInt(process.env.S3_MAX_ATTEMPTS || '5', 10);

const httpHandler = new NodeHttpHandler({
    connectionTimeout: S3_CONN_TIMEOUT,
    requestTimeout: S3_REQ_TIMEOUT,
    httpAgent: new HttpAgent({ keepAlive: true, maxSockets: 64 }),
    httpsAgent: new HttpsAgent({ keepAlive: true, maxSockets: 64 }),
});

const s3Client = new S3Client({ 
    region: process.env.AWS_REGION || 'ap-south-1',
    requestHandler: httpHandler,
    maxAttempts: S3_MAX_ATTEMPTS,
});

const bucket = process.env.S3_BUCKET_NAME;

// Cache for bookmark queries
interface BookmarkCacheItem {
  data: any[];
  timestamp: number;
}

const bookmarkCache = new Map<string, BookmarkCacheItem>();
const BOOKMARK_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const BOOKMARK_CACHE_MAX_ENTRIES = 5000; // safety cap to prevent unbounded growth

// Metrics tracking for bookmark operations
interface BookmarkMetrics {
  totalOperations: number;
  cacheHits: number;
  cacheMisses: number;
  errors: number;
}

const metrics: BookmarkMetrics = {
  totalOperations: 0,
  cacheHits: 0,
  cacheMisses: 0,
  errors: 0
};

function enforceBookmarkCacheLimit() {
  // Evict oldest entries if cache grows too large
  if (bookmarkCache.size <= BOOKMARK_CACHE_MAX_ENTRIES) return;
  const entries: Array<{ key: string; ts: number }> = [];
  for (const [key, item] of bookmarkCache.entries()) {
    entries.push({ key, ts: item.timestamp });
  }
  // Oldest first
  entries.sort((a, b) => a.ts - b.ts);
  const toEvict = bookmarkCache.size - BOOKMARK_CACHE_MAX_ENTRIES;
  for (let i = 0; i < toEvict; i++) {
    bookmarkCache.delete(entries[i].key);
  }
}

export class BookmarkService {
  /**
   * Safely extract and verify JWT token from request
   */
  private static extractUserId(req: Request): { success: boolean; userId?: string; error?: string } {
    try {
      const authHeader = req.headers.authorization;
      
      if (!authHeader) {
        return { success: false, error: "No authorization header provided" };
      }
      
      if (!authHeader.startsWith('Bearer ')) {
        return { success: false, error: "Invalid authorization header format" };
      }
      
      const token = authHeader.split(' ')[1];
      if (!token) {
        return { success: false, error: "No token found in authorization header" };
      }
      
      if (!JWT_SECRET) {
        console.error('JWT_SECRET is not configured');
        return { success: false, error: "Server configuration error" };
      }
      
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      
      if (!decoded.userId) {
        return { success: false, error: "Invalid token format - no userId" };
      }
      
      return { success: true, userId: decoded.userId };
      
    } catch (error) {
      console.error('JWT verification failed:', error);
      
      if (error instanceof jwt.TokenExpiredError) {
        return { success: false, error: "Token expired" };
      } else if (error instanceof jwt.JsonWebTokenError) {
        return { success: false, error: "Invalid token" };
      } else {
        return { success: false, error: "Authentication failed" };
      }
    }
  }

  /**
   * Validate if a bookmarked item still exists in S3
   */
  private static async validateBookmarkExists(itemId: string, itemType: string): Promise<boolean> {
    try {
      // Normalize the itemId to ensure proper S3 key format
      let normalizedKey = itemId;
      
      // Ensure proper leading slash for content items
      if (itemType === 'document' && !itemId.startsWith('/')) {
        normalizedKey = '/' + itemId;
      } else if (itemType === 'folder') {
        // For folders, ensure it ends with slash
        if (!itemId.endsWith('/')) {
          normalizedKey = itemId + '/';
        }
        // Ensure proper leading slash
        if (!itemId.startsWith('/')) {
          normalizedKey = '/' + itemId;
        }
      }

      if (itemType === 'document') {
        // For files, use HEAD request to check if file exists
        await s3Client.send(new HeadObjectCommand({ 
          Bucket: bucket, 
          Key: normalizedKey 
        }));
        return true;
      } else if (itemType === 'folder') {
        // For folders, use LIST request to check if folder exists and has contents
        const response = await s3Client.send(new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: normalizedKey,
          MaxKeys: 1
        }));
        // Folder exists if it has at least one object (including the folder marker)
        return Boolean(response.Contents && response.Contents.length > 0);
      }
      
      return false;
    } catch (error: any) {
      // If HEAD or LIST request fails, item doesn't exist
      console.log(`Bookmark validation failed for ${itemType} ${itemId}:`, error.message);
      return false;
    }
  }

  /**
   * Clean up invalid bookmarks (items that no longer exist in S3)
   */
  private static async cleanupInvalidBookmarks(userId: string, bookmarks: any[]): Promise<{ validBookmarks: any[], removedCount: number }> {
    if (bookmarks.length === 0) {
      return { validBookmarks: [], removedCount: 0 };
    }

    console.log(`🔍 Validating ${bookmarks.length} bookmarks for user ${userId}`);
    
    const validBookmarks: any[] = [];
    const invalidBookmarkIds: string[] = [];
    let removedCount = 0;

    // Validate bookmarks concurrently with a reasonable limit
    const validationPromises = bookmarks.map(async (bookmark) => {
      const exists = await this.validateBookmarkExists(bookmark.itemId, bookmark.itemType);
      return { bookmark, exists };
    });

    const validationResults = await Promise.allSettled(validationPromises);
    
    for (const result of validationResults) {
      if (result.status === 'fulfilled') {
        const { bookmark, exists } = result.value;
        if (exists) {
          validBookmarks.push(bookmark);
        } else {
          invalidBookmarkIds.push(bookmark.id);
          console.log(`🗑️ Removing invalid bookmark: ${bookmark.itemType} ${bookmark.itemId}`);
        }
      } else {
        // If validation failed, assume bookmark is invalid
        console.error('Bookmark validation error:', result.reason);
        const bookmark = bookmarks[validationResults.indexOf(result)];
        if (bookmark) {
          invalidBookmarkIds.push(bookmark.id);
        }
      }
    }

    // Remove invalid bookmarks from database
    if (invalidBookmarkIds.length > 0) {
      try {
        const deleteResult = await prisma.bookmark.deleteMany({
          where: {
            id: { in: invalidBookmarkIds },
            userId: userId
          }
        });
        removedCount = deleteResult.count;
        console.log(`✅ Removed ${removedCount} invalid bookmarks from database`);
      } catch (error) {
        console.error('Failed to remove invalid bookmarks from database:', error);
      }
    }

    return { validBookmarks, removedCount };
  }

  /**
   * Get cached bookmarks or fetch from database
   */
  private static async getCachedBookmarks(userId: string): Promise<any[]> {
    const now = Date.now();
    const cacheKey = `bookmarks_${userId}`;
    
    // Check cache first
    const cached = bookmarkCache.get(cacheKey);
    if (cached && (now - cached.timestamp) < BOOKMARK_CACHE_TTL) {
      metrics.cacheHits++;
      return cached.data;
    }
    
    metrics.cacheMisses++;
    
    try {
      // Fetch from database with retry logic
      const bookmarks = await this.fetchBookmarksWithRetry(userId);
      
      // Clean up invalid bookmarks before caching
      const { validBookmarks, removedCount } = await this.cleanupInvalidBookmarks(userId, bookmarks);
      
      // Cache the cleaned result
      bookmarkCache.set(cacheKey, {
        data: validBookmarks,
        timestamp: now
      });
      enforceBookmarkCacheLimit();
      
      if (removedCount > 0) {
        console.log(`🧹 Cleaned up ${removedCount} invalid bookmarks for user ${userId}`);
      }
      
      return validBookmarks;
      
    } catch (error) {
      console.error('Error fetching bookmarks from database:', error);
      
      // Return cached data even if expired, or empty array
      if (cached) {
        console.log('Returning expired cached data due to database error');
        return cached.data;
      }
      
      return [];
    }
  }

  /**
   * Fetch bookmarks with retry logic for database resilience
   */
  private static async fetchBookmarksWithRetry(userId: string, maxRetries: number = 3): Promise<any[]> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const bookmarks = await prisma.bookmark.findMany({
          where: { userId },
          select: {
            id: true,
            itemId: true,
            itemName: true,
            itemType: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' }
        });
        
        return bookmarks;
        
      } catch (error: any) {
        console.error(`Bookmark fetch attempt ${attempt}/${maxRetries} failed:`, error);
        
        if (attempt === maxRetries) {
          throw error;
        }
        
        // Check if it's a connection error that might benefit from retry
        if (this.isRetryableError(error)) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Exponential backoff max 5s
          console.log(`Retrying bookmark fetch in ${delay}ms...`);
          await this.sleep(delay);
        } else {
          throw error; // Don't retry for non-retryable errors
        }
      }
    }
    
    throw new Error('Max retries exceeded for bookmark fetch');
  }

  /**
   * Check if error is retryable (connection issues)
   */
  private static isRetryableError(error: any): boolean {
    const retryableErrors = [
      'ECONNRESET',
      'ENOTFOUND', 
      'ECONNREFUSED',
      'ETIMEDOUT',
      'EAI_AGAIN',
      'connection lost',
      'connection terminated',
      'server has gone away'
    ];
    
    const errorMessage = error.message?.toLowerCase() || '';
    const errorCode = error.code?.toLowerCase() || '';
    
    return retryableErrors.some(retryableError => 
      errorMessage.includes(retryableError) || errorCode.includes(retryableError)
    );
  }

  /**
   * Sleep utility for retry delays
   */
  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Clear cache for a specific user
   */
  private static clearUserCache(userId: string): void {
    const cacheKey = `bookmarks_${userId}`;
    bookmarkCache.delete(cacheKey);
  }

  /**
   * Validate bookmark input data
   */
  private static validateBookmarkData(itemId: string, itemType: string, itemName: string): { valid: boolean; error?: string } {
    if (!itemId || typeof itemId !== 'string' || itemId.trim() === '') {
      return { valid: false, error: "itemId is required and must be a non-empty string" };
    }
    
    if (!itemType || typeof itemType !== 'string') {
      return { valid: false, error: "itemType is required and must be a string" };
    }
    
    if (!['document', 'folder'].includes(itemType)) {
      return { valid: false, error: "itemType must be 'document' or 'folder'" };
    }
    
    if (!itemName || typeof itemName !== 'string' || itemName.trim() === '') {
      return { valid: false, error: "itemName is required and must be a non-empty string" };
    }
    
    // Validate length limits
    if (itemId.length > 500) {
      return { valid: false, error: "itemId too long (max 500 characters)" };
    }
    
    if (itemName.length > 255) {
      return { valid: false, error: "itemName too long (max 255 characters)" };
    }
    
    return { valid: true };
  }

  /**
   * Create bookmark with comprehensive error handling
   */
  static async createBookmark(req: Request, res: Response): Promise<void> {
    metrics.totalOperations++;
    
    try {
      console.log('📚 BookmarkService.createBookmark called');
      console.log('Request body:', req.body);
      
      // Extract and verify user ID
      const authResult = this.extractUserId(req);
      if (!authResult.success) {
        console.error('Authentication failed:', authResult.error);
        res.status(401).json({ error: authResult.error });
        return;
      }
      
      const userId = authResult.userId!;
      const { itemId, itemType, itemName } = req.body;
      
      // Validate input data
      const validation = this.validateBookmarkData(itemId, itemType, itemName);
      if (!validation.valid) {
        console.error('Validation failed:', validation.error);
        res.status(400).json({ error: validation.error });
        return;
      }
      
      // Sanitize inputs
      const sanitizedItemId = String(itemId).trim();
      const sanitizedItemType = String(itemType).trim().toLowerCase();
      const sanitizedItemName = String(itemName).trim();
      
      console.log('Creating bookmark for:', { userId, itemId: sanitizedItemId, itemType: sanitizedItemType });
      
      try {
        // Check if bookmark already exists
        const existingBookmark = await prisma.bookmark.findUnique({
          where: {
            userId_itemId: {
              userId,
              itemId: sanitizedItemId
            }
          }
        });
        
        if (existingBookmark) {
          console.log('Bookmark already exists');
          res.status(409).json({ 
            error: "Item already bookmarked",
            bookmark: existingBookmark 
          });
          return;
        }
        
        // Create bookmark with transaction for consistency
        const bookmark = await prisma.$transaction(async (tx) => {
          return tx.bookmark.create({
            data: {
              userId,
              itemId: sanitizedItemId,
              itemType: sanitizedItemType,
              itemName: sanitizedItemName
            }
          });
        });
        
        // Clear cache to ensure fresh data
        this.clearUserCache(userId);
        
        console.log('✅ Bookmark created successfully:', bookmark.id);
        res.status(201).json({ 
          message: "Bookmark created successfully", 
          bookmark: {
            id: bookmark.id,
            itemId: bookmark.itemId,
            itemType: bookmark.itemType,
            itemName: bookmark.itemName,
            createdAt: bookmark.createdAt
          }
        });
        
      } catch (dbError: any) {
        console.error('Database error creating bookmark:', dbError);
        
        // Handle specific Prisma errors
        if (dbError.code === 'P2002') {
          // Unique constraint violation
          res.status(409).json({ error: "Item already bookmarked" });
        } else if (dbError.code === 'P2003') {
          // Foreign key constraint violation
          res.status(400).json({ error: "Invalid user or item reference" });
        } else {
          res.status(500).json({ error: "Failed to create bookmark" });
        }
      }
      
    } catch (error: any) {
      metrics.errors++;
      console.error('Unexpected error in createBookmark:', error);
      res.status(500).json({ error: "Internal server error" });
    }
  }

  /**
   * Delete bookmark with comprehensive error handling
   */
  static async deleteBookmark(req: Request, res: Response): Promise<void> {
    metrics.totalOperations++;
    
    try {
      console.log('🗑️ BookmarkService.deleteBookmark called');
      
      // Extract and verify user ID
      const authResult = this.extractUserId(req);
      if (!authResult.success) {
        console.error('Authentication failed:', authResult.error);
        res.status(401).json({ error: authResult.error });
        return;
      }
      
      const userId = authResult.userId!;
      const { itemId } = req.params;
      
      if (!itemId || typeof itemId !== 'string' || itemId.trim() === '') {
        res.status(400).json({ error: "itemId parameter is required" });
        return;
      }
      
      const sanitizedItemId = decodeURIComponent(itemId.trim());
      console.log('Deleting bookmark for:', { userId, itemId: sanitizedItemId });
      
      try {
        // Delete bookmark with transaction
        const deletedBookmark = await prisma.$transaction(async (tx) => {
          return tx.bookmark.delete({
            where: {
              userId_itemId: {
                userId,
                itemId: sanitizedItemId
              }
            }
          });
        });
        
        // Clear cache to ensure fresh data
        this.clearUserCache(userId);
        
        console.log('✅ Bookmark deleted successfully');
        res.json({ 
          message: "Bookmark removed successfully",
          deletedBookmark: {
            id: deletedBookmark.id,
            itemId: deletedBookmark.itemId,
            itemName: deletedBookmark.itemName
          }
        });
        
      } catch (dbError: any) {
        console.error('Database error deleting bookmark:', dbError);
        
        if (dbError.code === 'P2025') {
          // Record not found
          res.status(404).json({ error: "Bookmark not found" });
        } else {
          res.status(500).json({ error: "Failed to remove bookmark" });
        }
      }
      
    } catch (error: any) {
      metrics.errors++;
      console.error('Unexpected error in deleteBookmark:', error);
      res.status(500).json({ error: "Internal server error" });
    }
  }

  /**
   * Get user bookmarks with caching and error handling
   */
  static async getBookmarks(req: Request, res: Response): Promise<void> {
    metrics.totalOperations++;
    
    try {
      console.log('📋 BookmarkService.getBookmarks called');
      
      // Extract and verify user ID
      const authResult = this.extractUserId(req);
      if (!authResult.success) {
        console.error('Authentication failed:', authResult.error);
        res.status(401).json({ error: authResult.error });
        return;
      }
      
      const userId = authResult.userId!;
      console.log('Fetching bookmarks for userId:', userId);
      
      // Get bookmarks with caching and cleanup
      const bookmarks = await this.getCachedBookmarks(userId);
      
      console.log('✅ Bookmarks retrieved:', bookmarks.length);
      res.json({ 
        bookmarks,
        total: bookmarks.length,
        cached: bookmarkCache.has(`bookmarks_${userId}`),
        message: "Bookmarks retrieved successfully"
      });
      
    } catch (error: any) {
      metrics.errors++;
      console.error('Unexpected error in getBookmarks:', error);
      res.status(500).json({ error: "Failed to fetch bookmarks" });
    }
  }

  /**
   * Admin method to manually trigger bookmark cleanup for all users
   */
  static async cleanupAllBookmarks(req: Request, res: Response): Promise<void> {
    try {
      console.log('🧹 BookmarkService.cleanupAllBookmarks called');
      
      // Extract and verify user ID
      const authResult = this.extractUserId(req);
      if (!authResult.success) {
        console.error('Authentication failed:', authResult.error);
        res.status(401).json({ error: authResult.error });
        return;
      }
      
      const userId = authResult.userId!;
      
      // Verify user is admin
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { role: true }
      });
      
      if (!user || user.role !== 'admin') {
        res.status(403).json({ error: "Admin access required" });
        return;
      }
      
      // Get all users with bookmarks
      const usersWithBookmarks = await prisma.user.findMany({
        where: {
          bookmarks: {
            some: {}
          }
        },
        select: {
          id: true,
          email: true,
          _count: {
            select: {
              bookmarks: true
            }
          }
        }
      });
      
      let totalRemoved = 0;
      const results: Array<{ userId: string; email: string; removed: number; total: number }> = [];
      
      // Process each user's bookmarks
      for (const userData of usersWithBookmarks) {
        try {
          const bookmarks = await prisma.bookmark.findMany({
            where: { userId: userData.id },
            select: { id: true, itemId: true, itemType: true }
          });
          
          const { removedCount } = await this.cleanupInvalidBookmarks(userData.id, bookmarks);
          
          results.push({
            userId: userData.id,
            email: userData.email,
            removed: removedCount,
            total: userData._count.bookmarks
          });
          
          totalRemoved += removedCount;
          
          // Clear cache for this user
          this.clearUserCache(userData.id);
          
        } catch (error) {
          console.error(`Failed to cleanup bookmarks for user ${userData.email}:`, error);
          results.push({
            userId: userData.id,
            email: userData.email,
            removed: 0,
            total: userData._count.bookmarks
          });
        }
      }
      
      console.log(`✅ Cleanup completed: ${totalRemoved} total bookmarks removed`);
      res.json({
        message: "Bookmark cleanup completed",
        totalRemoved,
        results,
        processedUsers: usersWithBookmarks.length
      });
      
    } catch (error: any) {
      console.error('Unexpected error in cleanupAllBookmarks:', error);
      res.status(500).json({ error: "Failed to cleanup bookmarks" });
    }
  }

  /**
   * Bulk bookmark operations for efficiency
   */
  static async bulkBookmarkOperations(req: Request, res: Response): Promise<void> {
    metrics.totalOperations++;
    
    try {
      console.log('🔄 BookmarkService.bulkBookmarkOperations called');
      
      // Extract and verify user ID
      const authResult = this.extractUserId(req);
      if (!authResult.success) {
        console.error('Authentication failed:', authResult.error);
        res.status(401).json({ error: authResult.error });
        return;
      }
      
      const userId = authResult.userId!;
      const { operations } = req.body; // Array of { action: 'create'|'delete', itemId, itemType?, itemName? }
      
      if (!Array.isArray(operations) || operations.length === 0) {
        res.status(400).json({ error: "operations array is required" });
        return;
      }
      
      if (operations.length > 100) {
        res.status(400).json({ error: "Maximum 100 operations per request" });
        return;
      }
      
    interface BulkBookmarkOperation {
      action: 'create' | 'delete';
      itemId: string;
      itemType?: string;
      itemName?: string;
    }

    interface BulkBookmarkResult {
      index: number;
      action: 'create' | 'delete';
      bookmark?: any;
      deleted?: any;
    }

    interface BulkBookmarkError {
      index: number;
      error: string;
    }

    const results: BulkBookmarkResult[] = [];
    const ops: BulkBookmarkOperation[] = operations;
    const errors: BulkBookmarkError[] = [];
      
      // Process operations in transaction
      try {
        await prisma.$transaction(async (tx) => {
          for (const [index, operation] of operations.entries()) {
            try {
              if (operation.action === 'create') {
                const validation = this.validateBookmarkData(operation.itemId, operation.itemType, operation.itemName);
                if (!validation.valid) {
                  errors.push({ index, error: validation.error ?? 'Unknown validation error' });
                  continue;
                }
                
                const bookmark = await tx.bookmark.upsert({
                  where: {
                    userId_itemId: {
                      userId,
                      itemId: operation.itemId
                    }
                  },
                  update: {
                    itemName: operation.itemName,
                    itemType: operation.itemType
                  },
                  create: {
                    userId,
                    itemId: operation.itemId,
                    itemType: operation.itemType,
                    itemName: operation.itemName
                  }
                });
                
                results.push({ index, action: 'create', bookmark });
                
              } else if (operation.action === 'delete') {
                try {
                  const deleted = await tx.bookmark.delete({
                    where: {
                      userId_itemId: {
                        userId,
                        itemId: operation.itemId
                      }
                    }
                  });
                  
                  results.push({ index, action: 'delete', deleted });
                } catch (deleteError: any) {
                  if (deleteError.code === 'P2025') {
                    errors.push({ index, error: 'Bookmark not found' });
                  } else {
                    throw deleteError;
                  }
                }
              } else {
                errors.push({ index, error: 'Invalid action. Must be create or delete' });
              }
            } catch (opError) {
              console.error(`Error in bulk operation ${index}:`, opError);
              errors.push({ index, error: 'Operation failed' });
            }
          }
        });
        
        // Clear cache
        this.clearUserCache(userId);
        
        console.log(`✅ Bulk operation completed: ${results.length} successful, ${errors.length} failed`);
        res.json({
          message: "Bulk operations completed",
          successful: results.length,
          failed: errors.length,
          results,
          errors
        });
        
      } catch (dbError: any) {
        console.error('Database error in bulk operations:', dbError);
        res.status(500).json({ error: "Failed to process bulk operations" });
      }
      
    } catch (error: any) {
      metrics.errors++;
      console.error('Unexpected error in bulkBookmarkOperations:', error);
      res.status(500).json({ error: "Internal server error" });
    }
  }

  /**
   * Get bookmark metrics and cache statistics
   */
  static getMetrics(): any {
    const cacheStats = {
      totalCached: bookmarkCache.size,
      cacheHitRate: metrics.totalOperations > 0 ? 
        (metrics.cacheHits / (metrics.cacheHits + metrics.cacheMisses) * 100).toFixed(2) + '%' : '0%'
    };
    
    return {
      ...metrics,
      cache: cacheStats,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Clear all bookmark caches (admin function)
   */
  static clearAllCaches(): void {
    bookmarkCache.clear();
    console.log('📧 All bookmark caches cleared');
  }
}

// Periodic cache cleanup - ensure only one interval exists across hot reloads
declare global {
  // eslint-disable-next-line no-var
  var __bookmarkCacheCleanupInterval: ReturnType<typeof setInterval> | undefined;
}

if (!globalThis.__bookmarkCacheCleanupInterval) {
  globalThis.__bookmarkCacheCleanupInterval = setInterval(() => {
    try {
      const now = Date.now();
      let cleared = 0;
      
      for (const [key, item] of bookmarkCache.entries()) {
        if (now - item.timestamp > BOOKMARK_CACHE_TTL) {
          bookmarkCache.delete(key);
          cleared++;
        }
      }
      
      if (cleared > 0) {
        console.log(`🧹 Cleaned up ${cleared} expired bookmark cache entries`);
      }
    } catch (e) {
      console.error('Bookmark cache cleanup interval error:', e);
    }
  }, 60000);
}
