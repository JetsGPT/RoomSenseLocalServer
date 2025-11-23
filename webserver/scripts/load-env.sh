#!/bin/bash
# Load environment variables from .env file or Docker secrets
# Priority: .env file > Docker secrets > compose.yaml env > defaults
# This script is used by the application startup to load configuration

set -e

SECRETS_DIR="/run/secrets"
SECRETS_VOLUME="/webserver/secrets"
ENV_FILE="/webserver/.env"

# Function to read secret from Docker secret or file
read_secret() {
    local secret_name=$1
    local default_value=$2
    
    # Try Docker secret first (swarm mode)
    if [ -f "${SECRETS_DIR}/${secret_name}" ]; then
        cat "${SECRETS_DIR}/${secret_name}" 2>/dev/null | tr -d '\n'
        return 0
    fi
    
    # Try file-based secret (non-swarm mode)
    if [ -f "${SECRETS_VOLUME}/${secret_name}" ]; then
        cat "${SECRETS_VOLUME}/${secret_name}" 2>/dev/null | tr -d '\n'
        return 0
    fi
    
    # Return default if provided
    if [ -n "${default_value}" ]; then
        echo -n "${default_value}"
        return 0
    fi
    
    return 1
}

# Priority 1: Load from .env file if it exists (highest priority)
if [ -f "${ENV_FILE}" ]; then
    echo "✓ Loading environment from .env file (highest priority)"
    set -a
    # Source .env file, ignoring errors for missing variables
    source "${ENV_FILE}" 2>/dev/null || true
    set +a
    echo "  Environment loaded from .env file"
else
    echo "  No .env file found, will use secrets/defaults"
fi

# Priority 2: Load sensitive values from secrets if not set by .env
# Only load from secrets if the variable is not already set (from .env or compose.yaml)

if [ -z "${SESSION_SECRET}" ]; then
    SESSION_SECRET=$(read_secret "session_secret" "")
    if [ -n "${SESSION_SECRET}" ]; then
        echo "  ✓ Loaded SESSION_SECRET from secret"
    fi
fi

if [ -z "${PGPASSWORD}" ]; then
    PGPASSWORD=$(read_secret "pgpassword" "password")
    if [ -f "${SECRETS_DIR}/pgpassword" ] || [ -f "${SECRETS_VOLUME}/pgpassword" ]; then
        echo "  ✓ Loaded PGPASSWORD from secret"
    fi
fi

if [ -z "${INFLUX_PASSWORD}" ]; then
    INFLUX_PASSWORD=$(read_secret "influx_password" "admin123")
    if [ -f "${SECRETS_DIR}/influx_password" ] || [ -f "${SECRETS_VOLUME}/influx_password" ]; then
        echo "  ✓ Loaded INFLUX_PASSWORD from secret"
    fi
fi

if [ -z "${INFLUX_TOKEN}" ]; then
    INFLUX_TOKEN=$(read_secret "influx_token" "")
    if [ -n "${INFLUX_TOKEN}" ]; then
        echo "  ✓ Loaded INFLUX_TOKEN from secret"
    fi
fi

# Priority 3: Set defaults for other variables if not already set
# (These may already be set by compose.yaml or .env file)

export PGHOST=${PGHOST:-postgres}
export PGUSER=${PGUSER:-postgres}
export PGPORT=${PGPORT:-5432}
export PGDATABASE=${PGDATABASE:-user}

export INFLUX_USERNAME=${INFLUX_USERNAME:-admin}
export INFLUX_ORG=${INFLUX_ORG:-RoomSense}
export INFLUX_BUCKET=${INFLUX_BUCKET:-sensors_data}
export INFLUX_URL=${INFLUX_URL:-https://influxdb:8086}

export MQTT_BROKER=${MQTT_BROKER:-localhost}
export MQTT_PORT=${MQTT_PORT:-1883}

export BLE_GATEWAY_URL=${BLE_GATEWAY_URL:-http://host.docker.internal:8080}

export DEV_BYPASS_AUTH=${DEV_BYPASS_AUTH:-0}
export TRUST_PROXY=${TRUST_PROXY:-0}
export RATE_LIMIT_TRUST_PROXY=${RATE_LIMIT_TRUST_PROXY:-0}
export PERM_CACHE_MS=${PERM_CACHE_MS:-30000}

# Validate critical variables
if [ -z "${SESSION_SECRET}" ]; then
    echo "ERROR: SESSION_SECRET is not set!" >&2
    echo "       Please create a .env file or ensure secrets are initialized." >&2
    exit 1
fi

# Export all variables for use by Node.js
export SESSION_SECRET
export PGHOST
export PGUSER
export PGPASSWORD
export PGPORT
export PGDATABASE
export INFLUX_USERNAME
export INFLUX_PASSWORD
export INFLUX_ORG
export INFLUX_BUCKET
export INFLUX_TOKEN
export INFLUX_URL
export MQTT_BROKER
export MQTT_PORT
export BLE_GATEWAY_URL
export DEV_BYPASS_AUTH
export TRUST_PROXY
export RATE_LIMIT_TRUST_PROXY
export PERM_CACHE_MS

echo "✓ Environment variables loaded and validated"

