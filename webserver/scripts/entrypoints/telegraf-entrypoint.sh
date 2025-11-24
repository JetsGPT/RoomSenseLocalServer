#!/bin/sh
# Telegraf entrypoint that loads InfluxDB token from Docker Swarm secret
# Security: Token is read from /run/secrets/influx_token (mounted by Docker Swarm)

set -e

SECRET_FILE="/run/secrets/influx_token"
CONFIG_FILE="/etc/telegraf/telegraf.conf"
TEMP_CONFIG="/tmp/telegraf.conf"

# Load InfluxDB token from Docker Swarm secret if it exists
if [ -f "${SECRET_FILE}" ]; then
    # Remove both CR and LF characters to prevent line ending issues
    # Using input redirection is more reliable than piping
    INFLUX_TOKEN=$(tr -d '\r\n' < "${SECRET_FILE}")
    export INFLUX_TOKEN
    echo "✓ Loaded INFLUX_TOKEN from Docker Swarm secret"
    
    # Replace ${INFLUX_TOKEN} in config file with actual token value
    # Telegraf doesn't do env var substitution in config files
    # Escape special characters in token for sed
    ESCAPED_TOKEN=$(echo "${INFLUX_TOKEN}" | sed 's/[[\.*^$()+?{|]/\\&/g')
    sed "s|\${INFLUX_TOKEN}|${ESCAPED_TOKEN}|g" "${CONFIG_FILE}" > "${TEMP_CONFIG}"
    CONFIG_FILE="${TEMP_CONFIG}"
else
    echo "⚠️  Warning: ${SECRET_FILE} not found, using environment variable if set"
fi

# Start telegraf with the configuration
exec telegraf --config "${CONFIG_FILE}"

