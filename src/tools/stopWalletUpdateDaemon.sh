#!/bin/bash
# Stop the wallet update daemon

# Set the path to the project directory
PROJECT_DIR="$(dirname "$(dirname "$(dirname "$(realpath "$0")")")")"

# Navigate to the project directory
cd "$PROJECT_DIR" || exit 1

# Log file for the daemon
LOG_FILE="$PROJECT_DIR/src/logs/wallet_update_daemon.log"
PID_FILE="$PROJECT_DIR/src/logs/wallet_update_daemon.pid"

# Check if PID file exists
if [ ! -f "$PID_FILE" ]; then
    echo "PID file not found. Daemon may not be running."
    exit 1
fi

# Read the PID from the file
PID=$(cat "$PID_FILE")

# Check if the process is still running
if ps -p "$PID" > /dev/null; then
    echo "Stopping wallet update daemon (PID: $PID)..."
    kill -15 "$PID"
    
    # Wait for the process to terminate
    for i in {1..10}; do
        if ! ps -p "$PID" > /dev/null; then
            echo "Daemon stopped successfully."
            echo "$(date): Daemon stopped successfully." >> "$LOG_FILE"
            rm "$PID_FILE"
            exit 0
        fi
        sleep 1
    done
    
    # Force kill if it doesn't terminate gracefully
    echo "Daemon did not terminate gracefully. Forcing kill..."
    kill -9 "$PID"
    echo "$(date): Daemon forcefully terminated." >> "$LOG_FILE"
    rm "$PID_FILE"
else
    echo "No running daemon found with PID: $PID"
    rm "$PID_FILE"
fi