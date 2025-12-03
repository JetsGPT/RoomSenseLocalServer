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

# Load MQTT password from Docker Swarm secret if it exists
MQTT_SECRET_FILE="/run/secrets/mqtt_password"
if [ -f "${MQTT_SECRET_FILE}" ]; then
    MQTT_PASSWORD=$(tr -d '\r\n' < "${MQTT_SECRET_FILE}")
    export MQTT_PASSWORD
    export MQTT_USERNAME="telegraf"
    echo "✓ Loaded MQTT_PASSWORD from Docker Swarm secret"
    
    # Replace ${MQTT_PASSWORD} and ${MQTT_USERNAME} in config file
    # We use the potentially already modified CONFIG_FILE (TEMP_CONFIG)
    
    # Escape special characters in password for sed
    ESCAPED_PASSWORD=$(echo "${MQTT_PASSWORD}" | sed 's/[[\.*^$()+?{|]/\\&/g')
    
    # Create a new temp file or overwrite the existing one
    NEW_TEMP_CONFIG="/tmp/telegraf_final.conf"
    sed "s|\${MQTT_PASSWORD}|${ESCAPED_PASSWORD}|g" "${CONFIG_FILE}" | \
    sed "s|\${MQTT_USERNAME}|${MQTT_USERNAME}|g" > "${NEW_TEMP_CONFIG}"
    
    CONFIG_FILE="${NEW_TEMP_CONFIG}"
fi

# Start telegraf with the configuration
exec telegraf --config "${CONFIG_FILE}"

