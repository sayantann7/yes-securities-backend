#!/bin/bash
# filepath: start-admin.sh

echo "Starting Yes Securities Admin Web App..."

# Navigate to admin app directory
cd ~/sales_team_repos/ys-web-app/admin

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
echo $ADMIN_PID > admin.pid
echo "Admin service started with PID: $ADMIN_PID"
echo "Admin app is running on http://localhost:3001"