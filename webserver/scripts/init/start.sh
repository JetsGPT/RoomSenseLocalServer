#!/bin/bash
# Startup script for RoomSense Local Server
# This script initializes Docker Swarm, creates secrets, and starts containers
# Security: Uses Docker Swarm secrets for sensitive data

set -euo pipefail

# Get the project root directory (two levels up from this script)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${PROJECT_ROOT}"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_step() {
    echo -e "${BLUE}[STEP]${NC} $1"
}

# Check if Docker is available
check_docker() {
    if ! command -v docker >/dev/null 2>&1; then
        log_error "Docker is not installed or not in PATH"
        exit 1
    fi
    
    if ! docker info >/dev/null; then
        log_error "Cannot connect to Docker daemon"
        exit 1
    fi
}

# Initialize Docker Swarm if not already initialized
init_swarm() {
    log_step "Checking Docker Swarm status..."
    
    if docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null | grep -q "active"; then
        log_info "Docker Swarm is already initialized"
        return 0
    fi
    
    log_step "Initializing Docker Swarm..."
    if docker swarm init --advertise-addr 127.0.0.1; then
        log_info "Docker Swarm initialized successfully"
    else
        log_error "Failed to initialize Docker Swarm"
        exit 1
    fi
}

# Generate cryptographically secure random secret
generate_secure_secret() {
    local length=${1:-64}  # Default 64 bytes = 128 hex characters
    openssl rand -hex "${length}" 2>/dev/null || {
        log_warn "OpenSSL not available, using /dev/urandom fallback"
        head -c "${length}" /dev/urandom | xxd -p -c "${length}" | tr -d '\n'
    }
}

# Check if a secret exists in Docker Swarm
secret_exists() {
    local secret_name=$1
    docker secret ls --format "{{.Name}}" 2>/dev/null | grep -q "^${secret_name}$" || return 1
}

# Create a Docker Swarm secret
create_secret() {
    local secret_name=$1
    local secret_value=$2
    
    if secret_exists "${secret_name}"; then
        log_info "Secret '${secret_name}' already exists, skipping creation"
        return 0
    fi
    
    log_info "Creating secret '${secret_name}'..."
    # Use printf instead of echo -n for better portability and reliability
    # printf doesn't add any trailing newline, ensuring clean secret creation
    # Always generate secrets programmatically - never copy/paste
    if printf '%s' "${secret_value}" | docker secret create "${secret_name}" - ; then
        log_info "Secret '${secret_name}' created successfully"
    else
        log_error "Failed to create secret '${secret_name}'"
        exit 1
    fi
}

# Initialize all required secrets
init_secrets() {
    log_step "Initializing Docker Swarm secrets..."
    
    # SESSION_SECRET - Generate cryptographically secure random value
    # Recommended: 32+ bytes (64+ hex characters) for session secrets
    if ! secret_exists "session_secret"; then
        SESSION_SECRET=$(generate_secure_secret 64)
        create_secret "session_secret" "${SESSION_SECRET}"
        log_info "Generated new SESSION_SECRET (128 hex characters)"
    else
        log_info "SESSION_SECRET already exists"
    fi
    
    # PostgreSQL password - Generate secure password
    # Recommended: 32+ bytes for database passwords
    if ! secret_exists "pgpassword"; then
        PGPASSWORD=$(generate_secure_secret 32)
        create_secret "pgpassword" "${PGPASSWORD}"
        log_info "Generated new PostgreSQL password (64 hex characters)"
    else
        log_info "PostgreSQL password already exists"
    fi
    
    # InfluxDB password - Generate secure password
    # Recommended: 32+ bytes for database passwords
    if ! secret_exists "influx_password"; then
        INFLUX_PASSWORD=$(generate_secure_secret 32)
        create_secret "influx_password" "${INFLUX_PASSWORD}"
        log_info "Generated new InfluxDB password (64 hex characters)"
    else
        log_info "InfluxDB password already exists"
    fi
    
    # InfluxDB token - Generate cryptographically secure token
    # Recommended: 32+ bytes (64+ hex characters) for API tokens
    if ! secret_exists "influx_token"; then
        INFLUX_TOKEN=$(generate_secure_secret 32)
        create_secret "influx_token" "${INFLUX_TOKEN}"
        log_info "Generated new InfluxDB token (64 hex characters)"
    else
        log_info "InfluxDB token already exists"
    fi

    # MQTT password - Generate secure password
    if ! secret_exists "mqtt_password"; then
        MQTT_PASSWORD=$(generate_secure_secret 32)
        create_secret "mqtt_password" "${MQTT_PASSWORD}"
        log_info "Generated new MQTT password (64 hex characters)"
    else
        log_info "MQTT password already exists"
    fi

    # Web App DB Password - Low privilege user
    if ! secret_exists "webapp_password"; then
        WEBAPP_PASSWORD=$(generate_secure_secret 32)
        create_secret "webapp_password" "${WEBAPP_PASSWORD}"
        log_info "Generated new WebApp DB password (64 hex characters)"
    else
        log_info "WebApp DB password already exists"
    fi

    # BLE Gateway API Key
    if ! secret_exists "ble_gateway_api_key"; then
        BLE_API_KEY=$(generate_secure_secret 32)
        create_secret "ble_gateway_api_key" "${BLE_API_KEY}"
        log_info "Generated new BLE Gateway API Key (64 hex characters)"
    else
        log_info "BLE Gateway API Key already exists"
    fi
    
    log_info "All secrets initialized successfully!"
}

# Check and create required directories and files for bind mounts
check_mounts() {
    log_step "Checking required mount points..."
    
    # Create .env file if it doesn't exist
    if [ ! -f ".env" ]; then
        log_warn ".env file not found, creating empty one (defaults will be used)"
        touch .env
    fi
    
    # Create mosquitto directories
    mkdir -p mosquitto/config mosquitto/data mosquitto/log
    
    # Create mosquitto config if missing
    if [ ! -f "mosquitto/config/mosquitto.conf" ]; then
        log_info "Creating default mosquitto.conf..."
        cat > mosquitto/config/mosquitto.conf <<EOF
persistence true
persistence_location /mosquitto/data/
log_dest file /mosquitto/log/mosquitto.log
listener 1883
allow_anonymous true
EOF
    fi
    
    # Create other required directories
    mkdir -p certs
    mkdir -p telegraf
    mkdir -p postgres-init
    mkdir -p bletomqtt
    
    # Create dummy certs if missing (to prevent mount errors)
    if [ ! -f "certs/server.key" ] || [ ! -f "certs/server.cert" ]; then
        log_warn "SSL certificates missing. Generating self-signed certificates..."
        openssl req -x509 -newkey rsa:4096 -keyout certs/server.key -out certs/server.cert -days 365 -nodes -subj "/CN=localhost" 2>/dev/null
    fi
    
    # Create influxdb self-signed certs if missing
    if [ ! -f "certs/influxdb-selfsigned.key" ] || [ ! -f "certs/influxdb-selfsigned.crt" ]; then
        log_warn "InfluxDB certificates missing. Generating self-signed certificates..."
        openssl req -x509 -newkey rsa:4096 -keyout certs/influxdb-selfsigned.key -out certs/influxdb-selfsigned.crt -days 365 -nodes -subj "/CN=influxdb" 2>/dev/null
    fi
    
    log_info "Mount points verified"
}

# Main execution
main() {
    echo "==========================================="
    echo "RoomSense Local Server - Secure Startup"
    echo "==========================================="
    echo ""
    
    # Check prerequisites
    check_docker
    
    # Initialize Docker Swarm
    init_swarm
    
    # Initialize secrets
    init_secrets
    
    # Check and create required mount points
    check_mounts
    
    echo ""
    log_step "Building images (if needed)..."
    echo ""
    
    # Build images first (docker stack deploy doesn't support build)
    # Build webserver image
    log_info "Building webserver image..."
    docker build -t roomsense-webserver:latest .
    
    # Build blegateway image
    log_info "Building blegateway image..."
    docker build -t roomsense-blegateway:latest ./bletomqtt
    
    echo ""
    log_step "Deploying stack with Docker Swarm..."
    echo ""
    
    # Deploy stack using docker stack deploy (required for Swarm secrets)
    # Stack name: roomsense
    docker stack deploy -c compose.yaml roomsense
    
    echo ""
    log_info "Startup complete!"
    log_info "Stack deployed. Check status with: docker stack services roomsense"
    log_info "View logs with: docker service logs -f roomsense_<service-name>"
    log_info ""
    log_info "To view all services: docker stack ps roomsense"
}

main "$@"

