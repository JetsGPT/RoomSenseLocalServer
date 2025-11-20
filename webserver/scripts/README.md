# Initialization Scripts

This directory contains scripts for first-boot initialization and environment variable loading.

## Scripts

### `start.sh`
Main entry point for the container. This script:
- Checks if this is the first boot
- Runs secret initialization if needed
- Loads environment variables
- Starts the Node.js application

### `init-secrets.sh`
Initializes Docker secrets on first boot:
- Generates secure random values for sensitive data
- Creates Docker secrets (swarm mode) or file-based secrets (compose mode)
- Skips creation if secrets already exist or are provided in `.env` file

### `load-env.sh`
Loads environment variables with priority:
1. `.env` file (if exists) - highest priority
2. Docker secrets (if variable not in `.env`)
3. compose.yaml environment variables
4. Hardcoded defaults

## Usage

These scripts are automatically executed by the container on startup. You don't need to run them manually.

## Manual Execution

If you need to run them manually (for testing or debugging):

```bash
# From inside the container
docker compose exec webserver bash

# Run initialization
/webserver/scripts/init-secrets.sh

# Load environment
source /webserver/scripts/load-env.sh

# Check variables
env | grep SESSION_SECRET
```

## File Locations

- Scripts: `/webserver/scripts/`
- Secrets (file-based): `/webserver/secrets/`
- Environment file: `/webserver/.env`
- Initialization flag: `/var/lib/roomsense/.initialized`

