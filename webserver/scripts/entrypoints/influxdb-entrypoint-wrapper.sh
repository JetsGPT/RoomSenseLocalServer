#!/bin/bash
# InfluxDB entrypoint wrapper that loads password and token from Docker Swarm secrets
# Security: Secrets are read from /run/secrets (mounted by Docker Swarm)

set -e

PASSWORD_SECRET="/run/secrets/influx_password"
TOKEN_SECRET="/run/secrets/influx_token"

# Load InfluxDB password from Docker Swarm secret if it exists
if [ -f "${PASSWORD_SECRET}" ]; then
    # Remove both CR and LF characters to prevent line ending issues
    # Using input redirection is more reliable than piping
    export DOCKER_INFLUXDB_INIT_PASSWORD=$(tr -d '\r\n' < "${PASSWORD_SECRET}")
    echo "✓ Loaded DOCKER_INFLUXDB_INIT_PASSWORD from Docker Swarm secret"
else
    echo "⚠️  Warning: ${PASSWORD_SECRET} not found, using environment variable if set"
fi

# Load InfluxDB token from Docker Swarm secret if it exists
if [ -f "${TOKEN_SECRET}" ]; then
    # Remove both CR and LF characters to prevent line ending issues
    # This ensures the token is clean for HTTP headers
    # Using input redirection is more reliable than piping
    export DOCKER_INFLUXDB_INIT_ADMIN_TOKEN=$(tr -d '\r\n' < "${TOKEN_SECRET}")
    echo "✓ Loaded DOCKER_INFLUXDB_INIT_ADMIN_TOKEN from Docker Swarm secret"
else
    echo "⚠️  Warning: ${TOKEN_SECRET} not found, using environment variable if set"
fi

# Execute the original InfluxDB entrypoint
exec /entrypoint.sh "$@"

