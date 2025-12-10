#!/bin/bash
# Docker Swarm Secrets Initialization Script
# This script initializes Docker Swarm and creates secure secrets
# Security: Uses cryptographically secure random generation

set -euo pipefail

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
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

# Generate cryptographically secure random secret
# Uses OpenSSL with /dev/urandom (recommended for secrets)
generate_secure_secret() {
    local length=${1:-64}  # Default 64 bytes = 128 hex characters
    openssl rand -hex "${length}" 2>/dev/null || {
        # Fallback if openssl not available (shouldn't happen in Docker)
        log_warn "OpenSSL not available, using /dev/urandom fallback"
        head -c "${length}" /dev/urandom | xxd -p -c "${length}" | tr -d '\n'
    }
}

# Check if Docker Swarm is initialized
is_swarm_initialized() {
    docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null | grep -q "active" || return 1
}

# Initialize Docker Swarm if not already initialized
init_swarm() {
    if is_swarm_initialized; then
        log_info "Docker Swarm is already initialized"
        return 0
    fi
    
    log_info "Initializing Docker Swarm..."
    if docker swarm init --advertise-addr 127.0.0.1; then
        log_info "Docker Swarm initialized successfully"
    else
        log_error "Failed to initialize Docker Swarm"
        exit 1
    fi
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
    log_info "Initializing Docker Swarm secrets..."
    
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
    
    log_info "All secrets initialized successfully!"
}

# Main execution
main() {
    log_info "Starting Docker Swarm secrets initialization..."
    
    # Check if Docker is available
    if ! command -v docker >/dev/null 2>&1; then
        log_error "Docker is not available"
        exit 1
    fi
    
    # Check if we can access Docker daemon
    if ! docker info >/dev/null; then
        log_error "Cannot access Docker daemon"
        exit 1
    fi
    
    # Initialize Docker Swarm
    init_swarm
    
    # Initialize secrets
    init_secrets
    
    log_info "Initialization complete!"
}

main "$@"

