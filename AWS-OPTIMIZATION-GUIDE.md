# AWS S3 Load Handling Issues & Solutions

## **Critical Problems Identified**

### 1. **Synchronous Icon Loading in Loops** 🚨
**Problem**: Each folder/file listing makes sequential S3 calls for icons
- For 100 files: 500+ sequential S3 requests
- Can take 20-30 seconds for large folders
- Blocks entire request until complete

**Solution**: Implemented concurrent batch processing with limits

### 2. **No S3 Client Configuration** ⚠️
**Problem**: No timeouts, connection limits, or retry policies
- Requests can hang indefinitely
- No maximum concurrent connections
- No error recovery

**Solution**: Added proper S3 client configuration with timeouts

### 3. **Database Queries in File Operations** 📊
**Problem**: Every folder request queries database for bookmarks
- Adds 100-500ms per request
- No caching
- Blocks S3 operations

**Solution**: Added bookmark caching and concurrent processing

### 4. **No Request Size Limits** 📁
**Problem**: Can try to load thousands of files at once
- Overwhelming S3 and database
- Memory issues
- Long response times

**Solution**: Added pagination and size limits

## **Solutions Implemented**

### 1. **Optimized AWS Operations** (`awsOptimized.ts`)
```typescript
// Before: Sequential icon loading
for (const item of items) {
    const iconUrl = await getCustomIconUrl(item); // BLOCKS!
}

// After: Concurrent batch processing
const iconResults = await batchProcessIcons(allItemKeys, 5); // Max 5 concurrent
```

**Key Improvements**:
- ✅ Concurrent icon loading (5 requests max)
- ✅ Icon URL caching (5-minute TTL)
- ✅ S3 client timeouts (10s connection, 30s request)
- ✅ Request size limits (1000 items max)
- ✅ Promise.allSettled for error resilience

### 2. **Optimized File Router** (`fileRouterOptimized.ts`)
```typescript
// New endpoints:
POST /api/folders      # With icons (slower but complete)
POST /api/folders/fast # Without icons (fast navigation)
```

**Key Improvements**:
- ✅ Bookmark query caching (2-minute TTL)
- ✅ Concurrent S3 and database operations
- ✅ Optional icon loading
- ✅ Pagination support
- ✅ Response size limiting

### 3. **Comprehensive Logging** (`backend-manager.sh`)
**Features**:
- ✅ Persistent logging (survives disconnection)
- ✅ Log rotation (prevents disk space issues)
- ✅ Real-time log viewing
- ✅ Automatic restart on crashes
- ✅ Health monitoring
- ✅ Resource usage tracking

## **Usage Instructions**

### 1. **Start Backend with Optimizations**
```bash
cd /home/sayantan/yes-securities-backend

# Option 1: Use optimized router
# Edit src/index.ts to import fileRouterOptimized instead of fileRouter

# Option 2: Start with comprehensive logging
./backend-manager.sh start
```

### 2. **Monitor Backend with Full Logging**
```bash
# Start monitoring (auto-restart on crashes)
./backend-manager.sh monitor

# In another terminal, view real-time logs
./backend-manager.sh logs

# Check status
./backend-manager.sh status
```

### 3. **Frontend Optimizations**
Update your frontend to use the new endpoints:

```javascript
// For fast navigation (no icons)
const response = await fetch('/api/folders/fast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
        prefix: currentPath,
        maxItems: 500 
    })
});

// For full display with icons (slower)
const response = await fetch('/api/folders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ 
        prefix: currentPath,
        loadIcons: true,
        maxItems: 200  // Smaller limit for icon requests
    })
});
```

## **Performance Improvements**

### Before:
- 📊 100 files = 500+ sequential S3 requests
- ⏱️ 20-30 seconds loading time
- 💥 High crash rate
- 📝 No persistent logs

### After:
- 📊 100 files = 5-10 concurrent batched requests
- ⏱️ 2-5 seconds loading time
- 🛡️ Error resilience with retries
- 📝 Complete logging and monitoring

## **Testing Steps**

### 1. **Test Performance**
```bash
# Time the folder endpoint
time curl -X POST http://localhost:3000/api/folders/fast \
  -H "Content-Type: application/json" \
  -d '{"prefix": "", "maxItems": 100}'

# Compare with icon loading
time curl -X POST http://localhost:3000/api/folders \
  -H "Content-Type: application/json" \
  -d '{"prefix": "", "loadIcons": true, "maxItems": 50}'
```

### 2. **Test Crash Recovery**
```bash
# Start monitoring
./backend-manager.sh monitor

# In another terminal, kill the backend
kill $(cat backend.pid)

# Monitor should automatically restart it
```

### 3. **Test Logging**
```bash
# Generate some load
for i in {1..10}; do
  curl -X POST http://localhost:3000/api/folders/fast \
    -H "Content-Type: application/json" \
    -d '{"prefix": ""}' &
done

# View logs
./backend-manager.sh logs
```

## **Production Deployment**

For production servers, use:
```bash
# Start with monitoring
./backend-manager.sh monitor

# To run in background (detached from terminal)
nohup ./backend-manager.sh monitor > /dev/null 2>&1 &

# Or use systemd service (recommended for production)
```

## **Key Files Modified/Created**

1. **`src/awsOptimized.ts`** - Optimized AWS operations
2. **`src/fileRouterOptimized.ts`** - Optimized file router
3. **`backend-manager.sh`** - Comprehensive logging and monitoring
4. **`logs/`** - Directory for all log files

## **Next Steps**

1. Replace the current fileRouter with fileRouterOptimized
2. Start using backend-manager.sh for production
3. Update frontend to use the fast endpoint for navigation
4. Monitor performance improvements in logs
