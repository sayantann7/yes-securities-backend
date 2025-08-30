# Bookmark Cleanup Feature

## Overview

The bookmark cleanup feature automatically removes bookmarks for files and folders that no longer exist in S3 storage. This prevents users from seeing broken bookmarks and ensures data consistency.

## Problem Solved

**Before**: When files or folders were deleted from S3, their bookmarks remained in the database, causing:
- Users to see broken bookmarks in their list
- Errors when trying to delete non-existent bookmarks
- Inconsistent data between S3 storage and bookmark database

**After**: Bookmarks are automatically validated and cleaned up, ensuring:
- Only valid bookmarks are shown to users
- Automatic removal of bookmarks for deleted items
- Consistent data between S3 and bookmarks

## How It Works

### 1. Automatic Validation on Bookmark Retrieval

When users request their bookmarks (`GET /bookmark/bookmarks`), the system:

1. **Fetches bookmarks** from the database
2. **Validates each bookmark** by checking if the item exists in S3:
   - For **files**: Uses HEAD request to check if file exists
   - For **folders**: Uses LIST request to check if folder has contents
3. **Removes invalid bookmarks** from the database
4. **Returns only valid bookmarks** to the user
5. **Caches the cleaned result** for performance

### 2. Proactive Cleanup on File/Folder Deletion

When files or folders are deleted:

1. **File deletion** (`DELETE /api/files/delete`): Removes bookmarks for the deleted file
2. **Folder deletion** (`DELETE /api/folders/delete`): Removes bookmarks for the deleted folder
3. **Cache invalidation**: Clears bookmark cache to ensure fresh data

### 3. Admin Manual Cleanup

Admins can trigger cleanup for all users:

- **Endpoint**: `POST /bookmark/bookmarks/admin/cleanup-all`
- **Purpose**: Remove all invalid bookmarks across all users
- **Access**: Admin role required

## Implementation Details

### Key Files Modified

1. **`src/bookmarkServiceOptimized.ts`**
   - Added `validateBookmarkExists()` method
   - Added `cleanupInvalidBookmarks()` method
   - Added `cleanupAllBookmarks()` admin method
   - Modified `getCachedBookmarks()` to include validation

2. **`src/fileRouterOptimized.ts`**
   - Added `removeBookmarksForItem()` function
   - Updated delete endpoints to remove bookmarks

3. **`src/bookmarkRouterOptimized.ts`**
   - Added admin cleanup endpoint

### Validation Logic

```typescript
// For files: HEAD request to check existence
await s3Client.send(new HeadObjectCommand({ 
  Bucket: bucket, 
  Key: normalizedKey 
}));

// For folders: LIST request to check contents
const response = await s3Client.send(new ListObjectsV2Command({
  Bucket: bucket,
  Prefix: normalizedKey,
  MaxKeys: 1
}));
return Boolean(response.Contents && response.Contents.length > 0);
```

### Performance Optimizations

- **Concurrent validation**: Multiple bookmarks validated simultaneously
- **Caching**: Validated results cached for 2 minutes
- **Error resilience**: Failed validations don't break the entire process
- **Batch operations**: Database operations batched for efficiency

## API Endpoints

### User Endpoints

#### `GET /bookmark/bookmarks`
- **Purpose**: Get user's bookmarks (with automatic cleanup)
- **Response**: Only valid bookmarks
- **Authentication**: Required

```json
{
  "bookmarks": [...],
  "total": 5,
  "cached": true,
  "message": "Bookmarks retrieved successfully"
}
```

### Admin Endpoints

#### `POST /bookmark/bookmarks/admin/cleanup-all`
- **Purpose**: Clean up invalid bookmarks for all users
- **Access**: Admin only
- **Response**: Summary of cleanup results

```json
{
  "message": "Bookmark cleanup completed",
  "totalRemoved": 15,
  "results": [
    {
      "userId": "...",
      "email": "user@example.com",
      "removed": 3,
      "total": 10
    }
  ],
  "processedUsers": 5
}
```

## Testing

### Manual Testing

1. **Create bookmarks** for existing files/folders
2. **Delete the files/folders** from S3
3. **Request bookmarks** - invalid ones should be automatically removed
4. **Check admin cleanup** - use the admin endpoint to clean all users

### Automated Testing

Run the test script:
```bash
node test-bookmark-cleanup.js
```

This script:
- Creates test bookmarks for existing/non-existing items
- Simulates the cleanup process
- Verifies that invalid bookmarks are removed

## Monitoring and Logging

### Console Logs

The system logs bookmark cleanup activities:

```
🔍 Validating 10 bookmarks for user abc123
🗑️ Removing invalid bookmark: document /deleted-file.txt
✅ Removed 3 invalid bookmarks from database
🧹 Cleaned up 3 invalid bookmarks for user abc123
```

### Metrics

Bookmark service tracks:
- Total operations
- Cache hits/misses
- Error counts
- Cleanup statistics

## Configuration

### Environment Variables

- `AWS_REGION`: S3 region (default: ap-south-1)
- `S3_BUCKET_NAME`: S3 bucket name
- `S3_CONN_TIMEOUT`: Connection timeout (default: 20s)
- `S3_REQ_TIMEOUT`: Request timeout (default: 45s)
- `S3_MAX_ATTEMPTS`: Retry attempts (default: 5)

### Cache Settings

- **Bookmark cache TTL**: 2 minutes
- **Max cache entries**: 5000
- **Icon cache TTL**: 5 minutes

## Error Handling

### Graceful Degradation

- **S3 errors**: Bookmark validation fails gracefully, doesn't break user experience
- **Database errors**: Falls back to cached data if available
- **Network timeouts**: Uses retry logic with exponential backoff

### Error Recovery

- **Invalid bookmarks**: Automatically removed
- **Cache corruption**: Automatically rebuilt
- **Service failures**: Logged but don't crash the application

## Best Practices

### For Developers

1. **Always validate bookmarks** before returning to users
2. **Use the cleanup endpoints** when deleting files/folders
3. **Monitor cleanup logs** for performance issues
4. **Test with real S3 data** to ensure accuracy

### For Administrators

1. **Run periodic cleanup** using the admin endpoint
2. **Monitor bookmark counts** for unusual patterns
3. **Check cleanup logs** for errors
4. **Test cleanup functionality** after major file operations

## Troubleshooting

### Common Issues

1. **Bookmarks not being cleaned up**
   - Check S3 permissions
   - Verify bucket name configuration
   - Check network connectivity

2. **Slow bookmark loading**
   - Reduce concurrent validation limit
   - Increase cache TTL
   - Check S3 performance

3. **Cache not working**
   - Verify cache configuration
   - Check memory usage
   - Restart the service

### Debug Commands

```bash
# Check bookmark counts
curl -H "Authorization: Bearer <token>" http://localhost:3000/bookmark/bookmarks

# Run admin cleanup
curl -X POST -H "Authorization: Bearer <admin-token>" http://localhost:3000/bookmark/bookmarks/admin/cleanup-all

# Clear all caches
curl -X POST -H "Authorization: Bearer <admin-token>" http://localhost:3000/bookmark/bookmarks/admin/clear-cache
```

## Future Enhancements

1. **Scheduled cleanup**: Automatic periodic cleanup jobs
2. **Bulk operations**: More efficient batch processing
3. **Analytics**: Detailed cleanup statistics and reporting
4. **Notifications**: Alert users when their bookmarks are cleaned up
5. **Recovery**: Option to restore accidentally removed bookmarks 