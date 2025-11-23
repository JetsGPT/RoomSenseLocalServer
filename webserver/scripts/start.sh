#!/bin/bash
# Main startup script for the webserver container
# This script initializes secrets on first boot and loads environment variables

set -e

INIT_FLAG="/var/lib/roomsense/.initialized"
INIT_SCRIPT="/webserver/scripts/init-secrets.sh"
ENV_LOADER="/webserver/scripts/load-env.sh"

# Create initialization flag directory
mkdir -p "$(dirname "${INIT_FLAG}")"

# Run initialization on first boot
if [ ! -f "${INIT_FLAG}" ]; then
    echo "=========================================="
    echo "First boot detected - initializing secrets"
    echo "=========================================="
    
    # Run initialization script
    if [ -f "${INIT_SCRIPT}" ]; then
        bash "${INIT_SCRIPT}"
    else
        echo "WARNING: Initialization script not found at ${INIT_SCRIPT}"
    fi
    
    # Mark as initialized
    touch "${INIT_FLAG}"
    echo "Initialization complete - flag created at ${INIT_FLAG}"
else
    echo "Container already initialized, skipping secret generation"
fi

# Convert .env file to Unix line endings if it exists (handles Windows CRLF)
if [ -f "/webserver/.env" ]; then
    echo "Converting .env file to Unix line endings..."
    dos2unix /webserver/.env || echo "dos2unix failed, trying sed..."
    sed -i 's/\r$//' /webserver/.env || echo "sed failed"
fi

# Load environment variables
if [ -f "${ENV_LOADER}" ]; then
    source "${ENV_LOADER}"
else
    echo "WARNING: Environment loader not found at ${ENV_LOADER}"
    echo "Falling back to system environment variables"
fi

# Start the Node.js application
echo "Starting Node.js application..."
exec node app.js

