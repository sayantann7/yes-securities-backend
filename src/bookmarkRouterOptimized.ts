import { Router } from "express";
import { BookmarkService } from "./bookmarkServiceOptimized";

const router = Router();

/**
 * Optimized Bookmark Router with comprehensive error handling
 * 
 * Features:
 * - Crash-resistant design with extensive error handling
 * - Caching with smart invalidation
 * - Performance monitoring and metrics
 * - Bulk operations support
 * - Retry logic for database failures
 * - Input validation and sanitization
 */

// Create bookmark
// @ts-ignore
router.post("/bookmarks", async (req, res) => {
  await BookmarkService.createBookmark(req, res);
});

// Delete bookmark  
// @ts-ignore
router.delete("/bookmarks/:itemId", async (req, res) => {
  await BookmarkService.deleteBookmark(req, res);
});

// Get user bookmarks
// @ts-ignore  
router.get("/bookmarks", async (req, res) => {
  await BookmarkService.getBookmarks(req, res);
});

// Bulk bookmark operations (create/delete multiple bookmarks)
// @ts-ignore
router.post("/bookmarks/bulk", async (req, res) => {
  await BookmarkService.bulkBookmarkOperations(req, res);
});

// Health check endpoint for bookmark service
// @ts-ignore
router.get("/bookmarks/health", async (req, res) => {
  try {
    const metrics = BookmarkService.getMetrics();
    
    res.json({
      status: "healthy",
      service: "bookmark",
      metrics,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Bookmark health check failed:', error);
    res.status(500).json({
      status: "unhealthy", 
      service: "bookmark",
      error: "Health check failed"
    });
  }
});

// Admin endpoint to clear bookmark caches
// @ts-ignore
router.post("/bookmarks/admin/clear-cache", async (req, res) => {
  try {
    // Basic admin check - in production you'd want proper admin middleware
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: "Authentication required" });
    }
    
    BookmarkService.clearAllCaches();
    
    res.json({
      message: "All bookmark caches cleared",
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error clearing bookmark caches:', error);
    res.status(500).json({ error: "Failed to clear caches" });
  }
});

export default router;
