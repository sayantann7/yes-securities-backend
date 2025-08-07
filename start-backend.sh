#!/bin/bash
# filepath: start-backend.sh

echo "Starting Yes Securities Backend Service..."

# Navigate to backend directory
cd ~/sales_team_repos/yes-securities-backend

# Check if node_modules exists, if not install dependencies
if [ ! -d "node_modules" ]; then
    echo "Installing backend dependencies..."
    npm install
fi

# Start the backend service in development mode
echo "Starting backend on port 3000..."
npm run dev &

# Store the process ID
BACKEND_PID=$!
echo $BACKEND_PID > backend.pid
echo "Backend service started with PID: $BACKEND_PID"
echo "Backend is running on http://localhost:3000"