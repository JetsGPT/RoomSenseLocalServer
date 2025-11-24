#!/bin/bash
# PostgreSQL entrypoint wrapper that loads password from Docker Swarm secret
# Security: Password is read from /run/secrets/pgpassword (mounted by Docker Swarm)

set -e

SECRET_FILE="/run/secrets/pgpassword"

# Load PostgreSQL password from Docker Swarm secret if it exists
if [ -f "${SECRET_FILE}" ]; then
    # Remove both CR and LF characters to prevent line ending issues
    # This ensures the password matches exactly what the webserver reads
    # Using input redirection is more reliable than piping
    export POSTGRES_PASSWORD=$(tr -d '\r\n' < "${SECRET_FILE}")
    # Also set PGPASSWORD for consistency
    export PGPASSWORD="${POSTGRES_PASSWORD}"
    echo "✓ Loaded POSTGRES_PASSWORD from Docker Swarm secret (length: ${#POSTGRES_PASSWORD})"
else
    echo "⚠️  Warning: ${SECRET_FILE} not found, using environment variable if set"
fi

# Execute the original PostgreSQL entrypoint
exec /usr/local/bin/docker-entrypoint.sh "$@"

