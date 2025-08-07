#!/bin/bash
# filepath: stop-backend.sh

echo "Stopping Yes Securities Backend Service..."

# Get the script directory (root directory)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Backend directory is a subdirectory of root
BACKEND_DIR="$SCRIPT_DIR/sales_team_repo/yes-securities-backend"

echo "Looking for backend in: $BACKEND_DIR"

# Check if PID file exists
if [ -f "$BACKEND_DIR/backend.pid" ]; then
    BACKEND_PID=$(cat "$BACKEND_DIR/backend.pid")
    
    # Check if process is still running
    if ps -p $BACKEND_PID > /dev/null; then
        echo "Stopping backend service with PID: $BACKEND_PID"
        kill $BACKEND_PID
        
        # Wait a moment for graceful shutdown
        sleep 2
        
        # Force kill if still running
        if ps -p $BACKEND_PID > /dev/null; then
            echo "Force killing backend service..."
            kill -9 $BACKEND_PID
        fi
        
        echo "Backend service stopped successfully"
    else
        echo "Backend service is not running (PID $BACKEND_PID not found)"
    fi
    
    # Remove PID file
    rm -f "$BACKEND_DIR/backend.pid"
else
    echo "No PID file found. Attempting to kill backend processes..."
    
    # Kill any node processes running on port 3000
    PORT_PID=$(lsof -ti:3000)
    if [ ! -z "$PORT_PID" ]; then
        echo "Killing process on port 3000: $PORT_PID"
        kill $PORT_PID
        sleep 2
        if ps -p $PORT_PID > /dev/null; then
            kill -9 $PORT_PID
        fi
        echo "Backend service stopped"
    else
        echo "No backend service found running on port 3000"
    fi
fi