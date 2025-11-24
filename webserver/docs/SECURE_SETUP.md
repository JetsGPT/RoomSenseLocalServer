# Secure Docker Swarm Secrets Setup

This document explains the secure secrets management system for RoomSense Local Server.

## Overview

The system uses **Docker Swarm secrets** for secure management of sensitive data (passwords, tokens, session secrets). Non-sensitive configuration is stored in `.env` file.

## Security Features

1. **Docker Swarm Secrets**: All sensitive data (passwords, tokens) are stored as Docker Swarm secrets
2. **Cryptographically Secure Generation**: Secrets are generated using OpenSSL's secure random number generator
3. **Least Privilege**: Each container only has access to the secrets it needs
4. **Automatic Initialization**: Swarm and secrets are automatically initialized on first startup
5. **Encrypted Storage**: Docker Swarm secrets are encrypted at rest

## How It Works

### Startup Process

1. **Initialize Docker Swarm** (if not already initialized)
2. **Generate Secrets** (if they don't exist):
   - `session_secret`: 128 hex characters (64 bytes) - for Express sessions
   - `pgpassword`: 64 hex characters (32 bytes) - PostgreSQL password
   - `influx_password`: 64 hex characters (32 bytes) - InfluxDB password
   - `influx_token`: 64 hex characters (32 bytes) - InfluxDB API token
3. **Create Docker Swarm Secrets** from generated values
4. **Start Containers** with secrets mounted at `/run/secrets/<secret_name>`

### Secret Access Control

Each service only receives the secrets it needs:

- **webserver**: `session_secret`, `pgpassword`, `influx_password`, `influx_token`
- **postgres**: `pgpassword` only
- **influxdb**: `influx_password`, `influx_token` only
- **telegraf**: `influx_token` only
- **blegateway**: No secrets (only MQTT config)
- **mosquitto**: No secrets
- **nginx-proxy-manager**: No secrets

## Usage

### Starting the System

Simply run the startup script:

**On Linux/macOS or Git Bash:**
```bash
./scripts/init/start.sh
```

**On Windows PowerShell:**
```powershell
.\scripts\init\start.ps1
```

**On Windows with Git Bash or WSL:**
```bash
bash scripts/init/start.sh
```

The script will:
1. Check Docker is available
2. Initialize Docker Swarm (if needed)
3. Generate and create secrets (if needed)
4. Start all containers with `docker compose up -d`

### Environment Variables

#### Non-Sensitive Configuration (.env file)

Create a `.env` file in the project root for non-sensitive configuration:

```env
# Database Configuration
PGHOST=postgres
PGUSER=postgres
PGPORT=5432
PGDATABASE=user

# InfluxDB Configuration
INFLUX_URL=https://influxdb:8086
INFLUX_ORG=RoomSense
INFLUX_BUCKET=sensors_data
INFLUX_USERNAME=admin

# MQTT Configuration
MQTT_BROKER=localhost
MQTT_PORT=1883

# Application Configuration
BLE_GATEWAY_URL=http://host.docker.internal:8080
DEV_BYPASS_AUTH=0
TRUST_PROXY=0
RATE_LIMIT_TRUST_PROXY=0
PERM_CACHE_MS=30000
```

**Note**: Do NOT put passwords, tokens, or session secrets in `.env` file. These are managed by Docker Swarm secrets.

#### Sensitive Values (Docker Swarm Secrets)

Sensitive values are automatically generated and stored as Docker Swarm secrets:

- `SESSION_SECRET` - Automatically generated (128 hex characters)
- `PGPASSWORD` - Automatically generated (64 hex characters)
- `INFLUX_PASSWORD` - Automatically generated (64 hex characters)
- `INFLUX_TOKEN` - Automatically generated (64 hex characters)

## Secret Generation Algorithm

Secrets are generated using OpenSSL's cryptographically secure random number generator:

```bash
openssl rand -hex <length>
```

- **Session Secret**: 64 bytes (128 hex characters) - Recommended for session encryption
- **Database Passwords**: 32 bytes (64 hex characters) - Recommended for database passwords
- **API Tokens**: 32 bytes (64 hex characters) - Recommended for API authentication

This uses `/dev/urandom` (Linux) or equivalent secure random sources, which is the recommended approach for generating cryptographic secrets.

## Viewing Secrets

To view existing secrets:

```bash
docker secret ls
```

To view a secret's value (requires Docker Swarm):

```bash
# Note: This requires access to a service that has the secret mounted
docker exec <container_name> cat /run/secrets/<secret_name>
```

## Updating Secrets

To regenerate a secret:

```bash
# Remove the existing secret
docker secret rm <secret_name>

# Restart the system (will regenerate the secret)
./scripts/init/start.sh
```

Or manually create a new secret:

```bash
# Generate new secret
NEW_SECRET=$(openssl rand -hex 32)

# Create Docker Swarm secret
echo -n "$NEW_SECRET" | docker secret create <secret_name> -

# Restart affected services
docker compose restart <service_name>
```

## Security Best Practices

1. **Never commit secrets to version control**
   - `.env` file should be in `.gitignore` (if it contains any sensitive data)
   - Secrets are managed by Docker Swarm, not stored in files

2. **Use strong, randomly generated secrets**
   - The system automatically generates cryptographically secure secrets
   - Never use weak passwords or predictable values

3. **Limit secret access**
   - Each service only receives the secrets it needs
   - Review `compose.yaml` to verify secret access is minimal

4. **Regularly rotate secrets**
   - Consider rotating secrets periodically in production
   - Update secrets using the methods described above

5. **Monitor secret access**
   - Use Docker Swarm logging to monitor secret usage
   - Review container logs for any secret-related errors

## Troubleshooting

### Secrets Not Created

**Problem**: Services fail to start because secrets don't exist

**Solution**: 
1. Ensure Docker Swarm is initialized: `docker swarm init`
2. Run `./scripts/init/start.sh` to create secrets automatically
3. Check secret creation: `docker secret ls`

### Cannot Access Docker Socket

**Problem**: `start.sh` fails with "Cannot connect to Docker daemon"

**Solution**:
1. Ensure Docker is running: `docker info`
2. On Linux, ensure user is in `docker` group
3. On Windows/Mac, ensure Docker Desktop is running

### Services Can't Read Secrets

**Problem**: Services start but can't read secrets from `/run/secrets`

**Solution**:
1. Verify secrets exist: `docker secret ls`
2. Check service has secret in `compose.yaml` under `secrets:` section
3. Verify secret is mounted: `docker exec <container> ls -la /run/secrets`

### Docker Swarm Already Initialized

**Problem**: Script fails because Swarm is already initialized

**Solution**: This is normal - the script will skip initialization if Swarm already exists. If you need to reinitialize:

```bash
docker swarm leave --force
./scripts/init/start.sh
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    start.sh                             │
│  - Initialize Docker Swarm                              │
│  - Generate secrets (openssl rand)                      │
│  - Create Docker Swarm secrets                          │
│  - Start containers (docker compose up)                │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│              Docker Swarm Secrets                        │
│  - session_secret (128 hex chars)                       │
│  - pgpassword (64 hex chars)                            │
│  - influx_password (64 hex chars)                       │
│  - influx_token (64 hex chars)                          │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│              Services (with secret access)              │
│                                                          │
│  webserver:  [session_secret, pgpassword,               │
│              influx_password, influx_token]             │
│                                                          │
│  postgres:   [pgpassword]                               │
│                                                          │
│  influxdb:  [influx_password, influx_token]            │
│                                                          │
│  telegraf:   [influx_token]                             │
│                                                          │
│  Others:     [no secrets]                               │
└─────────────────────────────────────────────────────────┘
```

## Files

### Scripts
- `scripts/init/start.sh` - Main startup script (initializes Swarm and secrets)
- `scripts/init/init-swarm-secrets.sh` - Internal script for secret initialization

### Entrypoints
- `scripts/entrypoints/telegraf-entrypoint.sh` - Telegraf entrypoint that loads InfluxDB token
- `scripts/entrypoints/postgres-entrypoint-wrapper.sh` - PostgreSQL entrypoint wrapper for password
- `scripts/entrypoints/influxdb-entrypoint-wrapper.sh` - InfluxDB entrypoint wrapper for password/token

### Application
- `compose.yaml` - Docker Compose configuration with secret definitions
- `src/` - Application source code
  - `src/app.js` - Main application entry point
  - `src/loadSecrets.js` - Module to load secrets into environment variables
  - `src/routes/` - API route handlers
  - `src/middleware/` - Express middleware
  - `src/auth/` - Authentication utilities

## Migration from Old System

If you're migrating from the old file-based secrets system:

1. **Backup existing secrets** (if needed):
   ```bash
   # Old secrets are in ./secrets/ directory
   cat ./secrets/session_secret
   ```

2. **Remove old secrets directory** (optional):
   ```bash
   rm -rf ./secrets/
   ```

3. **Start new system**:
   ```bash
   ./start.sh
   ```

4. **Verify secrets are created**:
   ```bash
   docker secret ls
   ```

The new system will automatically generate new secrets if they don't exist.

