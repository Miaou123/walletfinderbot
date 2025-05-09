#!/bin/bash
# Start the wallet update daemon as a background process

# Set the path to the project directory
PROJECT_DIR="$(dirname "$(dirname "$(dirname "$(realpath "$0")")")")"

# Navigate to the project directory
cd "$PROJECT_DIR" || exit 1

# Log file for the daemon
LOG_FILE="$PROJECT_DIR/src/logs/wallet_update_daemon.log"

# Create logs directory if it doesn't exist
mkdir -p "$(dirname "$LOG_FILE")"

# The number of days to set as threshold (default: 7)
DAYS=${1:-7}

echo "$(date): Starting wallet update daemon with ${DAYS} days threshold" >> "$LOG_FILE"

# Start the daemon in the background, redirect output to log file
nohup node src/tools/walletUpdateDaemon.js "$DAYS" >> "$LOG_FILE" 2>&1 &

# Get the process ID
PID=$!

# Save the PID to a file for later use
echo $PID > "$PROJECT_DIR/src/logs/wallet_update_daemon.pid"

echo "$(date): Wallet update daemon started with PID: $PID" >> "$LOG_FILE"
echo "Wallet update daemon started with PID: $PID"
echo "Log file: $LOG_FILE"