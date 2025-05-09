#!/bin/bash
# Schedule script to clean up old wallet records

# Set the path to the project directory
PROJECT_DIR="$(dirname "$(dirname "$(dirname "$(realpath "$0")")")")"

# Navigate to the project directory
cd "$PROJECT_DIR" || exit 1

# Log file for cleanup operations
LOG_FILE="$PROJECT_DIR/src/logs/wallet_cleanup.log"

# Create logs directory if it doesn't exist
mkdir -p "$(dirname "$LOG_FILE")"

# The number of months to set for cleanup (default: 3)
MONTHS=${1:-3}

echo "$(date): Starting wallet cleanup (${MONTHS} months)" >> "$LOG_FILE"

# Run the cleanup script
node src/tools/cleanOldWallets.js "$MONTHS" 2>&1 >> "$LOG_FILE"

# Check if the cleanup was successful
if [ $? -eq 0 ]; then
    echo "$(date): Cleanup completed successfully" >> "$LOG_FILE"
else
    echo "$(date): Cleanup failed" >> "$LOG_FILE"
fi

echo "----------------------------------------" >> "$LOG_FILE"