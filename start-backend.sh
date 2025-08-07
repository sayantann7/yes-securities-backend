#!/bin/bash
# filepath: start-backend.sh

echo "Starting Yes Securities Backend Service..."

# Get the script directory (root directory)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Backend directory is a subdirectory of root
BACKEND_DIR="$SCRIPT_DIR/sales_team_repo/yes-securities-backend"

echo "Root directory: $SCRIPT_DIR"
echo "Backend directory: $BACKEND_DIR"

# Verify the backend directory exists
if [ ! -d "$BACKEND_DIR" ]; then
    echo "Error: Backend directory not found at $BACKEND_DIR"
    echo "Please ensure the yes-securities-backend folder exists in the root directory"
    exit 1
fi

# Verify we can find package.json in the backend directory
if [ ! -f "$BACKEND_DIR/package.json" ]; then
    echo "Error: package.json not found in $BACKEND_DIR"
    echo "Please ensure the backend directory is properly set up"
    exit 1
fi

# Navigate to backend directory for all operations
cd "$BACKEND_DIR"

# Check if node_modules exists, if not install dependencies
if [ ! -d "node_modules" ]; then
    echo "Installing backend dependencies..."
    npm install
fi

# Check if Prisma client needs to be generated
if [ ! -d "src/generated/prisma" ]; then
    echo "Generating Prisma client..."
    npx prisma generate
fi

# Start the backend service in development mode
echo "Starting backend on port 3000..."
npm run dev &

# Store the process ID
BACKEND_PID=$!
echo $BACKEND_PID > "$BACKEND_DIR/backend.pid"
echo "Backend service started with PID: $BACKEND_PID"
echo "Backend is running on http://localhost:3000"
echo "Backend running from: $BACKEND_DIR"