#!/bin/bash
# filepath: stop-admin.sh

echo "Stopping Yes Securities Admin Web App..."

# Get the script directory (root directory)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Admin app directory
ADMIN_DIR="$SCRIPT_DIR/sales_team_repo/ys-web-app/admin-app"

echo "Looking for admin app in: $ADMIN_DIR"

# Check if PID file exists
if [ -f "$ADMIN_DIR/admin.pid" ]; then
    ADMIN_PID=$(cat "$ADMIN_DIR/admin.pid")
    
    # Check if process is still running
    if ps -p $ADMIN_PID > /dev/null; then
        echo "Stopping admin service with PID: $ADMIN_PID"
        kill $ADMIN_PID
        
        # Wait a moment for graceful shutdown
        sleep 2
        
        # Force kill if still running
        if ps -p $ADMIN_PID > /dev/null; then
            echo "Force killing admin service..."
            kill -9 $ADMIN_PID
        fi
        
        echo "Admin service stopped successfully"
    else
        echo "Admin service is not running (PID $ADMIN_PID not found)"
    fi
    
    # Remove PID file
    rm -f "$ADMIN_DIR/admin.pid"
else
    echo "No PID file found. Attempting to kill admin processes..."
    
    # Kill any node processes running on port 3001
    PORT_PID=$(lsof -ti:3001)
    if [ ! -z "$PORT_PID" ]; then
        echo "Killing process on port 3001: $PORT_PID"
        kill $PORT_PID
        sleep 2
        if ps -p $PORT_PID > /dev/null; then
            kill -9 $PORT_PID
        fi
        echo "Admin service stopped"
    else
        echo "No admin service found running on port 3001"
    fi
fi