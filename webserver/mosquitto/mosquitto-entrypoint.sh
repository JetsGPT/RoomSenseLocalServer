#!/bin/sh
set -e

# Read secret
if [ -f /run/secrets/mqtt_password ]; then
    # Read password and remove any whitespace/newlines
    MQTT_PASSWORD=$(cat /run/secrets/mqtt_password | tr -d '\r\n')
else
    echo "Error: mqtt_password secret not found"
    exit 1
fi

# Create password file
touch /mosquitto/config/passwd
mosquitto_passwd -b /mosquitto/config/passwd telegraf "$MQTT_PASSWORD"
mosquitto_passwd -b /mosquitto/config/passwd blegateway "$MQTT_PASSWORD"

# Fix permissions
chmod 0644 /mosquitto/config/passwd

# Start mosquitto
exec /usr/sbin/mosquitto -c /mosquitto/config/mosquitto.conf
