#!/bin/bash
# filepath: start-admin.sh

echo "Starting Yes Securities Admin Web App..."

# Get the script directory (root directory)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Admin app directory
ADMIN_DIR="$SCRIPT_DIR/sales_team_repo/ys-web-app/admin-app"

echo "Root directory: $SCRIPT_DIR"
echo "Admin directory: $ADMIN_DIR"

# Verify the admin directory exists
if [ ! -d "$ADMIN_DIR" ]; then
    echo "Error: Admin directory not found at $ADMIN_DIR"
    echo "Please ensure the ys-web-app/admin-app folder exists"
    exit 1
fi

# Verify we can find package.json in the admin directory
if [ ! -f "$ADMIN_DIR/package.json" ]; then
    echo "Error: package.json not found in $ADMIN_DIR"
    echo "Please ensure the admin directory is properly set up"
    exit 1
fi

# Navigate to admin directory
cd "$ADMIN_DIR"

# Check if node_modules exists, if not install dependencies
if [ ! -d "node_modules" ]; then
    echo "Installing admin app dependencies..."
    npm install
fi

# Start the admin service in development mode
echo "Starting admin app on port 3001..."
npm run dev &

# Store the process ID
ADMIN_PID=$!
echo $ADMIN_PID > "$ADMIN_DIR/admin.pid"
echo "Admin service started with PID: $ADMIN_PID"
echo "Admin app is running on http://localhost:3001"
echo "Admin running from: $ADMIN_DIR"