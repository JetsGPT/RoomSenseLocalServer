#!/bin/bash
# Initialize Docker secrets on first boot
# This script generates secrets if they don't exist and creates Docker secrets

set -e

SECRETS_DIR="/run/secrets"
SECRETS_VOLUME="/webserver/secrets"
ENV_FILE="/webserver/.env"

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

# Generate a secure random string
generate_secret() {
    openssl rand -hex 64
}

# Check if a secret exists in Docker secrets
secret_exists() {
    local secret_name=$1
    docker secret ls --format "{{.Name}}" | grep -q "^${secret_name}$" 2>/dev/null || \
    [ -f "${SECRETS_DIR}/${secret_name}" ] 2>/dev/null
}

# Create a Docker secret
create_secret() {
    local secret_name=$1
    local secret_value=$2
    
    if secret_exists "${secret_name}"; then
        log_info "Secret '${secret_name}' already exists, skipping creation"
        return 0
    fi
    
    log_info "Creating secret '${secret_name}'..."
    
    # Try to create Docker secret (works in swarm mode)
    # Note: This requires Docker Swarm mode and docker CLI available
    if command -v docker >/dev/null 2>&1; then
        # Check if we're in swarm mode
        if docker info 2>/dev/null | grep -q "Swarm: active"; then
            if echo -n "${secret_value}" | docker secret create "${secret_name}" - 2>/dev/null; then
                log_info "Docker secret '${secret_name}' created successfully (swarm mode)"
                return 0
            else
                log_warn "Failed to create Docker secret, falling back to file-based"
            fi
        else
            log_info "Not in Docker Swarm mode, using file-based secrets"
        fi
    else
        log_info "Docker CLI not available, using file-based secrets"
    fi
    
    # Fallback: create file-based secret (for non-swarm mode or when docker CLI unavailable)
    mkdir -p "${SECRETS_VOLUME}"
    echo -n "${secret_value}" > "${SECRETS_VOLUME}/${secret_name}"
    chmod 600 "${SECRETS_VOLUME}/${secret_name}"
    log_info "File-based secret '${secret_name}' created at ${SECRETS_VOLUME}/${secret_name}"
}

# Initialize all required secrets
init_secrets() {
    log_info "Initializing Docker secrets..."
    
    # Load .env if it exists to check for values
    local env_session_secret=""
    local env_pgpassword=""
    local env_influx_password=""
    local env_influx_token=""
    
    if [ -f "${ENV_FILE}" ]; then
        set -a
        source "${ENV_FILE}" 2>/dev/null || true
        set +a
        env_session_secret="${SESSION_SECRET:-}"
        env_pgpassword="${PGPASSWORD:-}"
        env_influx_password="${INFLUX_PASSWORD:-}"
        env_influx_token="${INFLUX_TOKEN:-}"
        # Clear variables to avoid conflicts
        unset SESSION_SECRET PGPASSWORD INFLUX_PASSWORD INFLUX_TOKEN
    fi
    
    # SESSION_SECRET - generate if not exists and not in .env
    if [ -z "${env_session_secret}" ] && ! secret_exists "session_secret"; then
        SESSION_SECRET=$(generate_secret)
        create_secret "session_secret" "${SESSION_SECRET}"
        log_info "Generated new SESSION_SECRET"
    elif [ -n "${env_session_secret}" ]; then
        log_info "SESSION_SECRET found in .env file, skipping secret creation"
    else
        log_info "SESSION_SECRET already exists in secrets"
    fi
    
    # PostgreSQL password - use default if not exists and not in .env
    if [ -z "${env_pgpassword}" ] && ! secret_exists "pgpassword"; then
        create_secret "pgpassword" "password"
        log_warn "Using default PostgreSQL password. Change it in production!"
    elif [ -n "${env_pgpassword}" ]; then
        log_info "PGPASSWORD found in .env file, skipping secret creation"
    else
        log_info "PostgreSQL password already exists in secrets"
    fi
    
    # InfluxDB password - use default if not exists and not in .env
    if [ -z "${env_influx_password}" ] && ! secret_exists "influx_password"; then
        create_secret "influx_password" "admin123"
        log_warn "Using default InfluxDB password. Change it in production!"
    elif [ -n "${env_influx_password}" ]; then
        log_info "INFLUX_PASSWORD found in .env file, skipping secret creation"
    else
        log_info "InfluxDB password already exists in secrets"
    fi
    
    # InfluxDB token - generate if not exists and not in .env
    if [ -z "${env_influx_token}" ] && ! secret_exists "influx_token"; then
        INFLUX_TOKEN=$(generate_secret)
        create_secret "influx_token" "${INFLUX_TOKEN}"
        log_info "Generated new INFLUX_TOKEN"
    elif [ -n "${env_influx_token}" ]; then
        log_info "INFLUX_TOKEN found in .env file, skipping secret creation"
    else
        log_info "InfluxDB token already exists in secrets"
    fi
    
    log_info "Secret initialization complete!"
}

# Main execution
main() {
    log_info "Starting secret initialization..."
    
    # Check if .env file exists
    if [ -f "${ENV_FILE}" ]; then
        log_info ".env file found - secrets will be used as fallback only"
        log_info "Secrets will only be created if they don't already exist"
    else
        log_info "No .env file found - will initialize secrets with defaults"
    fi
    
    # Create secrets directory if it doesn't exist
    mkdir -p "${SECRETS_VOLUME}"
    chmod 700 "${SECRETS_VOLUME}"
    
    # Initialize secrets
    init_secrets
    
    log_info "Initialization complete!"
}

main "$@"

