#!/bin/bash

# Backend monitoring script for Yes Securities
# This script monitors the backend process and restarts it if it crashes

BACKEND_DIR="/home/sayantan/yes-securities-backend"
LOG_FILE="$BACKEND_DIR/backend-monitor.log"
PID_FILE="$BACKEND_DIR/backend.pid"

log_message() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "$LOG_FILE"
}

start_backend() {
    log_message "Starting backend server..."
    cd "$BACKEND_DIR"
    
    # Kill any existing process
    if [ -f "$PID_FILE" ]; then
        OLD_PID=$(cat "$PID_FILE")
        if kill -0 "$OLD_PID" 2>/dev/null; then
            log_message "Killing existing process $OLD_PID"
            kill "$OLD_PID"
            sleep 2
        fi
        rm -f "$PID_FILE"
    fi
    
    # Start new process
    npm run dev > "$BACKEND_DIR/backend-output.log" 2>&1 &
    NEW_PID=$!
    echo "$NEW_PID" > "$PID_FILE"
    log_message "Backend started with PID $NEW_PID"
}

check_backend() {
    if [ ! -f "$PID_FILE" ]; then
        return 1
    fi
    
    PID=$(cat "$PID_FILE")
    if ! kill -0 "$PID" 2>/dev/null; then
        return 1
    fi
    
    # Check if the process is responding (optional HTTP check)
    if command -v curl > /dev/null 2>&1; then
        if ! curl -f -s http://localhost:3000/health > /dev/null 2>&1; then
            log_message "Backend not responding to health check"
            return 1
        fi
    fi
    
    return 0
}

# Main monitoring loop
log_message "Backend monitor started"

while true; do
    if ! check_backend; then
        log_message "Backend is down, restarting..."
        start_backend
        sleep 10  # Wait for startup
    else
        log_message "Backend is running normally"
    fi
    
    sleep 30  # Check every 30 seconds
done
