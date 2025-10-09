#!/bin/bash

# Advanced Caching Deployment Script
# This script deploys the 100x performance enhancement

set -e  # Exit on error

echo "🚀 YES Securities Backend - Advanced Caching Deployment"
echo "========================================================"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to print colored output
print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_info() {
    echo -e "ℹ️  $1"
}

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    print_error "package.json not found. Please run this script from the backend root directory."
    exit 1
fi

print_success "Found package.json"
echo ""

# Check if new cache service exists
if [ ! -f "src/advancedCacheService.ts" ]; then
    print_error "Advanced cache service not found. Please ensure all files are in place."
    exit 1
fi

print_success "Advanced cache service found"
echo ""

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 16 ]; then
    print_error "Node.js 16+ required. Current version: $(node -v)"
    exit 1
fi

print_success "Node.js version: $(node -v)"
echo ""

# Install dependencies (if needed)
print_info "Checking dependencies..."
if [ ! -d "node_modules" ]; then
    print_warning "node_modules not found. Installing dependencies..."
    npm install
    print_success "Dependencies installed"
else
    print_success "Dependencies OK"
fi
echo ""

# Backup existing dist folder
if [ -d "dist" ]; then
    print_info "Backing up existing build..."
    BACKUP_DIR="dist.backup.$(date +%Y%m%d_%H%M%S)"
    mv dist "$BACKUP_DIR"
    print_success "Backup created: $BACKUP_DIR"
fi
echo ""

# Build the project
print_info "Building TypeScript project..."
npm run build

if [ $? -eq 0 ]; then
    print_success "Build completed successfully"
else
    print_error "Build failed. Please check the errors above."
    exit 1
fi
echo ""

# Check if compiled cache service exists
if [ ! -f "dist/advancedCacheService.js" ]; then
    print_error "Compiled cache service not found. Build may have failed."
    exit 1
fi

print_success "Advanced cache service compiled"
echo ""

# Verify all critical files
print_info "Verifying compiled files..."
CRITICAL_FILES=(
    "dist/advancedCacheService.js"
    "dist/awsOptimized.js"
    "dist/fileRouterOptimized.js"
    "dist/index.js"
)

for file in "${CRITICAL_FILES[@]}"; do
    if [ -f "$file" ]; then
        print_success "$file ✓"
    else
        print_error "$file missing"
        exit 1
    fi
done
echo ""

# Check if server is running
print_info "Checking if server is already running..."
if [ -f "backend.pid" ]; then
    PID=$(cat backend.pid)
    if ps -p $PID > /dev/null 2>&1; then
        print_warning "Server is running (PID: $PID)"
        read -p "Stop and restart? (y/n) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            print_info "Stopping server..."
            kill $PID 2>/dev/null || true
            sleep 2
            print_success "Server stopped"
        else
            print_warning "Deployment cancelled. Please stop the server manually and try again."
            exit 0
        fi
    fi
fi
echo ""

# Create logs directory if it doesn't exist
mkdir -p logs
print_success "Logs directory ready"
echo ""

# Summary
echo "========================================================"
echo "🎉 Build Complete!"
echo "========================================================"
echo ""
print_info "Next steps:"
echo ""
echo "1. Start the server:"
echo "   npm run start"
echo "   OR"
echo "   npm run dev-monitor (with auto-restart)"
echo ""
echo "2. Verify deployment:"
echo "   tail -f logs/app.log | grep 'Advanced Multi-Layer Cache'"
echo ""
echo "3. Test performance:"
echo "   See QUICK-DEPLOY-ADVANCED-CACHE.md for test commands"
echo ""
echo "4. Monitor cache stats:"
echo "   tail -f logs/app.log | grep 'Cache Stats'"
echo ""
print_success "Deployment ready! 🚀"
echo ""

# Ask if user wants to start the server now
read -p "Start the server now? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    print_info "Starting server with monitoring..."
    if [ -f "./monitor-backend.sh" ]; then
        chmod +x ./monitor-backend.sh
        ./monitor-backend.sh
    else
        npm run start &
        echo $! > backend.pid
        print_success "Server started (PID: $(cat backend.pid))"
        echo ""
        print_info "Watching logs..."
        tail -f logs/app.log
    fi
else
    print_info "Server not started. Run 'npm run start' when ready."
fi
