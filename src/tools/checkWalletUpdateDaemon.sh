#!/bin/bash
# Check the status of the wallet update daemon

# Set the path to the project directory
PROJECT_DIR="$(dirname "$(dirname "$(dirname "$(realpath "$0")")")")"

# Navigate to the project directory
cd "$PROJECT_DIR" || exit 1

# Log file and PID file paths
LOG_FILE="$PROJECT_DIR/src/logs/wallet_update_daemon.log"
PID_FILE="$PROJECT_DIR/src/logs/wallet_update_daemon.pid"

# Check if PID file exists
if [ ! -f "$PID_FILE" ]; then
    echo "Status: NOT RUNNING (No PID file found)"
    exit 1
fi

# Read the PID from the file
PID=$(cat "$PID_FILE")

# Check if the process is still running
if ps -p "$PID" > /dev/null; then
    echo "Status: RUNNING"
    echo "PID: $PID"
    echo "Uptime: $(ps -o etime= -p "$PID")"
    echo "Log file: $LOG_FILE"
    
    # Show recent log entries
    echo ""
    echo "Recent log entries:"
    echo "----------------------------------------"
    tail -n 20 "$LOG_FILE"
else
    echo "Status: NOT RUNNING (PID $PID not found)"
    echo "The daemon may have crashed. Check the log file for details:"
    echo "$LOG_FILE"
    
    # Clean up stale PID file
    rm "$PID_FILE"
fi