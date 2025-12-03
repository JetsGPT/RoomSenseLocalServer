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

# Fix permissions and ownership
# We must ensure the mosquitto user (UID 1883) can read/write these
chown mosquitto:mosquitto /mosquitto/config/passwd
chmod 0700 /mosquitto/config/passwd

# Ensure data and log directories are writable by mosquitto
# These might be mounted as root, so we need to fix ownership
mkdir -p /mosquitto/data /mosquitto/log
chown -R mosquitto:mosquitto /mosquitto/data /mosquitto/log
chmod 0700 /mosquitto/data
chmod 0700 /mosquitto/log

# Start mosquitto
# Mosquitto will automatically drop privileges to 'mosquitto' user if started as root
exec /usr/sbin/mosquitto -c /mosquitto/config/mosquitto.conf
