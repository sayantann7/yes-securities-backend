#!/bin/bash

# Comprehensive Backend Logging and Monitoring Script
# This script ensures your backend runs continuously with full logging even when you disconnect

BACKEND_DIR="/home/sayantan/yes-securities-backend"
LOG_DIR="$BACKEND_DIR/logs"
MAIN_LOG="$LOG_DIR/backend-main.log"
ERROR_LOG="$LOG_DIR/backend-error.log"
ACCESS_LOG="$LOG_DIR/backend-access.log"
MONITOR_LOG="$LOG_DIR/monitor.log"
PID_FILE="$BACKEND_DIR/backend.pid"

# Create logs directory
mkdir -p "$LOG_DIR"

# Function to log with timestamp
log_message() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" | tee -a "$MONITOR_LOG"
}

# Function to rotate logs when they get too large (100MB)
rotate_logs() {
    local log_file="$1"
    local max_size=$((100 * 1024 * 1024)) # 100MB
    
    if [ -f "$log_file" ] && [ $(stat -f%z "$log_file" 2>/dev/null || stat -c%s "$log_file" 2>/dev/null || echo 0) -gt $max_size ]; then
        mv "$log_file" "${log_file}.old"
        touch "$log_file"
        log_message "Rotated log file: $log_file"
    fi
}

# Function to start backend with comprehensive logging
start_backend() {
    log_message "Starting backend server with full logging..."
    cd "$BACKEND_DIR"
    
    # Kill any existing process
    if [ -f "$PID_FILE" ]; then
        OLD_PID=$(cat "$PID_FILE")
        if kill -0 "$OLD_PID" 2>/dev/null; then
            log_message "Killing existing process $OLD_PID"
            kill "$OLD_PID"
            sleep 3
        fi
        rm -f "$PID_FILE"
    fi
    
    # Build the project first
    log_message "Building TypeScript project..."
    npm run build >> "$MAIN_LOG" 2>&1
    
    if [ $? -ne 0 ]; then
        log_message "Build failed! Check $MAIN_LOG for errors"
        return 1
    fi
    
    # Start backend with comprehensive logging
    log_message "Starting Node.js server..."
    
    # Use nohup to ensure process continues after logout
    # Redirect stdout to main log, stderr to error log
    nohup node dist/index.js \
        > >(tee -a "$MAIN_LOG") \
        2> >(tee -a "$ERROR_LOG" >&2) &
    
    NEW_PID=$!
    echo "$NEW_PID" > "$PID_FILE"
    
    # Wait a moment to check if process started successfully
    sleep 2
    
    if kill -0 "$NEW_PID" 2>/dev/null; then
        log_message "✅ Backend started successfully with PID $NEW_PID"
        log_message "📁 Logs available at:"
        log_message "   Main log: $MAIN_LOG"
        log_message "   Error log: $ERROR_LOG"
        log_message "   Monitor log: $MONITOR_LOG"
        return 0
    else
        log_message "❌ Backend failed to start"
        return 1
    fi
}

# Function to check if backend is running
check_backend() {
    if [ ! -f "$PID_FILE" ]; then
        return 1
    fi
    
    PID=$(cat "$PID_FILE")
    if ! kill -0 "$PID" 2>/dev/null; then
        return 1
    fi
    
    # Advanced health check with timeout
    if command -v curl > /dev/null 2>&1; then
        if timeout 10 curl -f -s http://localhost:3000/health > /dev/null 2>&1; then
            return 0
        else
            log_message "⚠️ Backend process exists but not responding to health check"
            return 1
        fi
    fi
    
    return 0
}

# Function to show logs in real-time
show_logs() {
    echo "=== BACKEND LOGS ==="
    echo "Press Ctrl+C to stop viewing logs"
    echo ""
    
    # Show last 50 lines and then follow
    echo "--- MAIN LOG ---"
    tail -50 "$MAIN_LOG" 2>/dev/null
    echo ""
    echo "--- ERROR LOG ---"
    tail -50 "$ERROR_LOG" 2>/dev/null
    echo ""
    echo "--- LIVE LOGS (Ctrl+C to exit) ---"
    
    # Follow both main and error logs
    tail -f "$MAIN_LOG" "$ERROR_LOG" 2>/dev/null
}

# Function to get backend status
get_status() {
    echo "=== BACKEND STATUS ==="
    
    if check_backend; then
        PID=$(cat "$PID_FILE")
        echo "✅ Backend is running (PID: $PID)"
        
        # Show memory and CPU usage if possible
        if command -v ps > /dev/null 2>&1; then
            echo "📊 Resource usage:"
            ps -p "$PID" -o pid,pcpu,pmem,etime,cmd 2>/dev/null || echo "   Unable to get resource info"
        fi
        
        # Test health endpoint
        if command -v curl > /dev/null 2>&1; then
            echo "🏥 Health check:"
            curl -s http://localhost:3000/health | head -c 200 2>/dev/null || echo "   Health check failed"
        fi
    else
        echo "❌ Backend is not running"
    fi
    
    echo ""
    echo "📁 Log files:"
    echo "   Main: $MAIN_LOG ($(wc -l < "$MAIN_LOG" 2>/dev/null || echo 0) lines)"
    echo "   Error: $ERROR_LOG ($(wc -l < "$ERROR_LOG" 2>/dev/null || echo 0) lines)"
    echo "   Monitor: $MONITOR_LOG ($(wc -l < "$MONITOR_LOG" 2>/dev/null || echo 0) lines)"
}

# Function to stop backend
stop_backend() {
    log_message "Stopping backend server..."
    
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if kill -0 "$PID" 2>/dev/null; then
            kill "$PID"
            sleep 2
            
            # Force kill if still running
            if kill -0 "$PID" 2>/dev/null; then
                kill -9 "$PID"
                log_message "Force killed backend process $PID"
            else
                log_message "Backend process $PID stopped gracefully"
            fi
        fi
        rm -f "$PID_FILE"
    else
        log_message "No PID file found"
    fi
}

# Main script logic
case "${1:-monitor}" in
    "start")
        start_backend
        ;;
    "stop")
        stop_backend
        ;;
    "restart")
        stop_backend
        sleep 2
        start_backend
        ;;
    "status")
        get_status
        ;;
    "logs")
        show_logs
        ;;
    "monitor")
        log_message "🔍 Backend monitor started (PID: $$)"
        log_message "Use '$0 logs' to view logs in real-time"
        log_message "Use '$0 status' to check current status"
        
        # Continuous monitoring loop
        while true; do
            # Rotate logs if needed
            rotate_logs "$MAIN_LOG"
            rotate_logs "$ERROR_LOG"
            rotate_logs "$MONITOR_LOG"
            
            if ! check_backend; then
                log_message "🚨 Backend is down, restarting..."
                start_backend
                
                if [ $? -eq 0 ]; then
                    log_message "✅ Backend restarted successfully"
                else
                    log_message "❌ Failed to restart backend, will retry in 30 seconds"
                fi
            else
                log_message "✅ Backend is running normally"
            fi
            
            sleep 30  # Check every 30 seconds
        done
        ;;
    "help"|"-h"|"--help")
        echo "Backend Management Script"
        echo ""
        echo "Usage: $0 [command]"
        echo ""
        echo "Commands:"
        echo "  start     - Start the backend server"
        echo "  stop      - Stop the backend server"
        echo "  restart   - Restart the backend server"
        echo "  status    - Show backend status and resource usage"
        echo "  logs      - Show real-time logs"
        echo "  monitor   - Run continuous monitoring (default)"
        echo "  help      - Show this help message"
        echo ""
        echo "Examples:"
        echo "  $0 start          # Start backend"
        echo "  $0 logs           # View logs in real-time"
        echo "  $0 monitor        # Run with auto-restart"
        echo ""
        echo "Log files are stored in: $LOG_DIR"
        ;;
    *)
        echo "Unknown command: $1"
        echo "Use '$0 help' for usage information"
        exit 1
        ;;
esac
