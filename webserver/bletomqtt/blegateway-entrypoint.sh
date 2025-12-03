#!/bin/sh
set -e

# Load MQTT password from Docker Swarm secret if it exists
MQTT_SECRET_FILE="/run/secrets/mqtt_password"
if [ -f "${MQTT_SECRET_FILE}" ]; then
    # Read password and remove any whitespace/newlines
    MQTT_PASSWORD=$(tr -d '\r\n' < "${MQTT_SECRET_FILE}")
    export MQTT_PASSWORD
    export MQTT_USERNAME="blegateway"
    echo "✓ Loaded MQTT_PASSWORD from Docker Swarm secret"
else
    echo "⚠️  Warning: ${MQTT_SECRET_FILE} not found"
fi

# Execute the original command
exec "$@"
