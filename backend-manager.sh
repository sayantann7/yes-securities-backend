#!/bin/bash

# Comprehensive Backend Management Script for Yes Securities
# Provides complete logging, monitoring, and crash recovery

BACKEND_DIR="/home/sayantan/yes-securities-backend"
LOG_DIR="$BACKEND_DIR/logs"
MAIN_LOG="$LOG_DIR/backend.log"
ERROR_LOG="$LOG_DIR/error.log"
ACCESS_LOG="$LOG_DIR/access.log"
PID_FILE="$BACKEND_DIR/backend.pid"
MAX_LOG_SIZE="100M"
HEALTH_URL="http://localhost:3000/health"

# Create logs directory
mkdir -p "$LOG_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function
log_message() {
    local level="$1"
    shift
    local message="$*"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    
    case $level in
        "INFO")
            echo -e "${GREEN}[$timestamp] INFO: $message${NC}" | tee -a "$MAIN_LOG"
            ;;
        "WARN")
            echo -e "${YELLOW}[$timestamp] WARN: $message${NC}" | tee -a "$MAIN_LOG"
            ;;
        "ERROR")
            echo -e "${RED}[$timestamp] ERROR: $message${NC}" | tee -a "$MAIN_LOG" | tee -a "$ERROR_LOG"
            ;;
        "DEBUG")
            echo -e "${BLUE}[$timestamp] DEBUG: $message${NC}" | tee -a "$MAIN_LOG"
            ;;
        *)
            echo "[$timestamp] $level: $message" | tee -a "$MAIN_LOG"
            ;;
    esac
}

# Check if backend is running
is_backend_running() {
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            return 0
        fi
    fi
    return 1
}

# Get backend PID
get_backend_pid() {
    if [ -f "$PID_FILE" ]; then
        cat "$PID_FILE"
    else
        echo "No PID file found"
        return 1
    fi
}

# Rotate logs if they exceed size limit
rotate_logs() {
    for log_file in "$MAIN_LOG" "$ERROR_LOG" "$ACCESS_LOG"; do
        if [ -f "$log_file" ]; then
            local size=$(du -h "$log_file" 2>/dev/null | cut -f1)
            if [ -n "$size" ]; then
                # Simple size check (this is basic, for production use logrotate)
                local file_size=$(stat -f%z "$log_file" 2>/dev/null || stat -c%s "$log_file" 2>/dev/null || echo "0")
                if [ "$file_size" -gt 104857600 ]; then  # 100MB
                    log_message "INFO" "Rotating log file: $log_file"
                    mv "$log_file" "$log_file.old"
                    touch "$log_file"
                fi
            fi
        fi
    done
}

# Start backend
start_backend() {
    log_message "INFO" "Starting backend server..."
    
    cd "$BACKEND_DIR" || {
        log_message "ERROR" "Cannot change to backend directory: $BACKEND_DIR"
        return 1
    }
    
    # Kill any existing process
    if is_backend_running; then
        local old_pid=$(get_backend_pid)
        log_message "WARN" "Backend already running with PID $old_pid, stopping it first..."
        stop_backend
        sleep 2
    fi
    
    # Build the backend
    log_message "INFO" "Building backend..."
    if ! npm run build >> "$MAIN_LOG" 2>&1; then
        log_message "ERROR" "Failed to build backend"
        return 1
    fi
    
    # Start new process with comprehensive logging
    log_message "INFO" "Starting new backend process..."
    nohup npm run start > "$MAIN_LOG" 2> "$ERROR_LOG" &
    local new_pid=$!
    
    echo "$new_pid" > "$PID_FILE"
    log_message "INFO" "Backend started with PID $new_pid"
    
    # Wait a moment and verify it's running
    sleep 3
    if is_backend_running; then
        log_message "INFO" "Backend startup successful"
        return 0
    else
        log_message "ERROR" "Backend failed to start properly"
        return 1
    fi
}

# Stop backend
stop_backend() {
    if is_backend_running; then
        local pid=$(get_backend_pid)
        log_message "INFO" "Stopping backend (PID: $pid)..."
        
        # Try graceful shutdown first
        kill "$pid" 2>/dev/null
        
        # Wait up to 10 seconds for graceful shutdown
        local count=0
        while [ $count -lt 10 ] && kill -0 "$pid" 2>/dev/null; do
            sleep 1
            count=$((count + 1))
        done
        
        # Force kill if still running
        if kill -0 "$pid" 2>/dev/null; then
            log_message "WARN" "Graceful shutdown failed, forcing kill..."
            kill -9 "$pid" 2>/dev/null
            sleep 1
        fi
        
        rm -f "$PID_FILE"
        log_message "INFO" "Backend stopped"
    else
        log_message "WARN" "Backend is not running"
    fi
}

# Restart backend
restart_backend() {
    log_message "INFO" "Restarting backend..."
    stop_backend
    sleep 2
    start_backend
}

# Monitor backend with auto-restart
monitor_backend() {
    log_message "INFO" "Starting backend monitoring with auto-restart..."
    log_message "INFO" "Logs are being written to: $LOG_DIR"
    
    while true; do
        if ! is_backend_running; then
            log_message "WARN" "Backend is down, attempting restart..."
            start_backend
        else
            # Health check
            if command -v curl > /dev/null 2>&1; then
                if ! curl -f -s "$HEALTH_URL" > /dev/null 2>&1; then
                    log_message "WARN" "Backend health check failed, restarting..."
                    restart_backend
                fi
            fi
        fi
        
        # Rotate logs if they get too large
        rotate_logs
        
        # Show status
        show_status
        
        sleep 30  # Check every 30 seconds
    done
}

# Show backend status
show_status() {
    echo ""
    echo "=== Backend Status $(date) ==="
    
    if is_backend_running; then
        local pid=$(get_backend_pid)
        echo -e "${GREEN}✅ Backend is running (PID: $pid)${NC}"
        
        # Memory usage
        if command -v ps > /dev/null 2>&1; then
            local mem_usage=$(ps -o pid,ppid,pcpu,pmem,comm -p "$pid" 2>/dev/null)
            if [ $? -eq 0 ]; then
                echo "Memory/CPU usage:"
                echo "$mem_usage"
            fi
        fi
        
        # Health check
        if command -v curl > /dev/null 2>&1; then
            local health_response=$(curl -s "$HEALTH_URL" 2>/dev/null)
            if [ $? -eq 0 ]; then
                echo -e "${GREEN}✅ Health check: PASSED${NC}"
                echo "Health details: $health_response"
            else
                echo -e "${RED}❌ Health check: FAILED${NC}"
            fi
        fi
    else
        echo -e "${RED}❌ Backend is not running${NC}"
    fi
    
    # Recent errors
    if [ -f "$ERROR_LOG" ]; then
        local error_count=$(wc -l < "$ERROR_LOG" 2>/dev/null || echo "0")
        if [ "$error_count" -gt 0 ]; then
            echo -e "${YELLOW}⚠️  Recent errors found: $error_count${NC}"
            echo "Last 3 errors:"
            tail -3 "$ERROR_LOG" 2>/dev/null || echo "No errors found"
        fi
    fi
    
    echo "=========================="
}

# Show real-time logs
show_logs() {
    local log_type="${1:-main}"
    
    case $log_type in
        "error")
            echo "Following error log (Ctrl+C to stop)..."
            tail -f "$ERROR_LOG"
            ;;
        "access")
            echo "Following access log (Ctrl+C to stop)..."
            tail -f "$ACCESS_LOG"
            ;;
        "main"|*)
            echo "Following main log (Ctrl+C to stop)..."
            tail -f "$MAIN_LOG"
            ;;
    esac
}

# Get system info
get_system_info() {
    echo "=== System Information ==="
    echo "Date: $(date)"
    echo "Uptime: $(uptime)"
    echo "Disk usage:"
    df -h "$BACKEND_DIR" 2>/dev/null || echo "Cannot get disk usage"
    echo "Memory usage:"
    free -h 2>/dev/null || echo "Cannot get memory usage"
    echo "Node.js version: $(node --version 2>/dev/null || echo 'Not found')"
    echo "NPM version: $(npm --version 2>/dev/null || echo 'Not found')"
    echo "=========================="
}

# Backup logs
backup_logs() {
    local backup_dir="$LOG_DIR/backups/$(date +%Y%m%d_%H%M%S)"
    mkdir -p "$backup_dir"
    
    log_message "INFO" "Backing up logs to: $backup_dir"
    
    for log_file in "$MAIN_LOG" "$ERROR_LOG" "$ACCESS_LOG"; do
        if [ -f "$log_file" ]; then
            cp "$log_file" "$backup_dir/"
        fi
    done
    
    # Compress backup
    if command -v gzip > /dev/null 2>&1; then
        gzip "$backup_dir"/*
        log_message "INFO" "Logs compressed and backed up"
    fi
}

# Analyze logs for issues
analyze_logs() {
    echo "=== Log Analysis ==="
    
    if [ -f "$ERROR_LOG" ]; then
        echo "Error log analysis:"
        echo "Total errors: $(wc -l < "$ERROR_LOG")"
        echo "Most common errors:"
        grep -o "Error: [^']*" "$ERROR_LOG" 2>/dev/null | sort | uniq -c | sort -nr | head -5
    fi
    
    if [ -f "$MAIN_LOG" ]; then
        echo ""
        echo "Main log analysis:"
        echo "Total log entries: $(wc -l < "$MAIN_LOG")"
        echo "Recent activity (last 10 entries):"
        tail -10 "$MAIN_LOG"
    fi
    
    echo "===================="
}

# Show help
show_help() {
    echo "Backend Management Script for Yes Securities"
    echo ""
    echo "Usage: $0 [command]"
    echo ""
    echo "Commands:"
    echo "  start          Start the backend server"
    echo "  stop           Stop the backend server"
    echo "  restart        Restart the backend server"
    echo "  status         Show current backend status"
    echo "  monitor        Start monitoring with auto-restart"
    echo "  logs [type]    Follow logs (type: main, error, access)"
    echo "  backup         Backup current logs"
    echo "  analyze        Analyze logs for issues"
    echo "  info           Show system information"
    echo "  help           Show this help message"
    echo ""
    echo "Log files location: $LOG_DIR"
    echo "PID file location: $PID_FILE"
}

# Main script logic
case "${1:-help}" in
    "start")
        start_backend
        ;;
    "stop")
        stop_backend
        ;;
    "restart")
        restart_backend
        ;;
    "status")
        show_status
        ;;
    "monitor")
        monitor_backend
        ;;
    "logs")
        show_logs "$2"
        ;;
    "backup")
        backup_logs
        ;;
    "analyze")
        analyze_logs
        ;;
    "info")
        get_system_info
        ;;
    "help"|*)
        show_help
        ;;
esac
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
