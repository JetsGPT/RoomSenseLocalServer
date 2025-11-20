# First Boot Initialization System

This document explains how the RoomSense Local Server handles environment variables and secrets on first boot.

## Overview

The system supports three methods for configuration, in order of priority:

1. **`.env` file** (highest priority) - If present, all values are loaded from this file
2. **Docker Secrets** - Secure values are stored as Docker secrets (or file-based secrets)
3. **Generated defaults** - On first boot, secrets are automatically generated if not present

## How It Works

### First Boot Process

When the container starts for the first time:

1. **Check for `.env` file**
   - If `.env` exists → Load all variables from it (highest priority)
   - If `.env` doesn't exist → Proceed to secret initialization

2. **Initialize secrets** (only if `.env` doesn't exist or secrets are missing)
   - Generate `SESSION_SECRET` (128-character hex string)
   - Create `pgpassword` secret (default: "password")
   - Create `influx_password` secret (default: "admin123")
   - Generate `influx_token` (128-character hex string)
   - Store secrets as Docker secrets (swarm mode) or file-based secrets (non-swarm)

3. **Load environment variables**
   - Priority: `.env` → Docker secrets → compose.yaml defaults → hardcoded defaults
   - All variables are exported for the Node.js application

4. **Start the application**
   - Node.js inherits all exported environment variables

### Subsequent Boots

After first boot:
- Initialization flag is checked (`/var/lib/roomsense/.initialized`)
- If flag exists, skip secret generation
- Load environment from `.env` or existing secrets
- Start application

## Configuration Methods

### Method 1: Using `.env` File (Recommended for Development)

Create a `.env` file in the `webserver/` directory:

```env
SESSION_SECRET=your-secret-here
PGHOST=postgres
PGUSER=postgres
PGPASSWORD=your-password
PGPORT=5432
PGDATABASE=user
INFLUX_USERNAME=admin
INFLUX_PASSWORD=your-password
INFLUX_ORG=RoomSense
INFLUX_BUCKET=sensors_data
INFLUX_TOKEN=your-token
INFLUX_URL=https://influxdb:8086
MQTT_BROKER=localhost
MQTT_PORT=1883
BLE_GATEWAY_URL=http://host.docker.internal:8080
```

**Advantages:**
- Easy to edit and version control (but don't commit secrets!)
- All values in one place
- Works immediately without initialization

**Note:** The `.env` file takes precedence over all other sources.

### Method 2: Using Docker Secrets (Recommended for Production)

On first boot without `.env` file, secrets are automatically generated and stored.

#### Docker Swarm Mode

If running in Docker Swarm mode, secrets are stored as Docker secrets:

```bash
# View secrets
docker secret ls

# Inspect a secret
docker secret inspect session_secret
```

#### Non-Swarm Mode (Docker Compose)

Secrets are stored as files in `webserver/secrets/`:

```
webserver/secrets/
├── session_secret
├── pgpassword
├── influx_password
└── influx_token
```

**Advantages:**
- Secure storage (file permissions: 600)
- Automatic generation on first boot
- No manual configuration needed

**Note:** The `secrets/` directory is mounted as a volume and persists across container restarts.

### Method 3: Manual Secret Creation

You can manually create secrets before first boot:

#### For Docker Swarm:

```bash
# Generate and create secrets
echo "your-secret-value" | docker secret create session_secret -
echo "your-password" | docker secret create pgpassword -
echo "admin123" | docker secret create influx_password -
echo "your-token" | docker secret create influx_token -
```

#### For Docker Compose:

```bash
mkdir -p webserver/secrets
chmod 700 webserver/secrets

# Create secret files
echo -n "your-secret-value" > webserver/secrets/session_secret
echo -n "your-password" > webserver/secrets/pgpassword
echo -n "admin123" > webserver/secrets/influx_password
echo -n "your-token" > webserver/secrets/pgpassword

# Set permissions
chmod 600 webserver/secrets/*
```

## Environment Variable Priority

The system loads variables in this order (later sources override earlier ones):

1. **Hardcoded defaults** (in scripts)
2. **compose.yaml environment** (defaults)
3. **Docker secrets** (if variable not set)
4. **`.env` file** (highest priority - overrides everything)

## Security Considerations

### Sensitive Values

The following values should be kept secure:
- `SESSION_SECRET` - Used for session encryption
- `PGPASSWORD` - PostgreSQL database password
- `INFLUX_PASSWORD` - InfluxDB admin password
- `INFLUX_TOKEN` - InfluxDB API token

### Best Practices

1. **Development:**
   - Use `.env` file (convenient)
   - Add `.env` to `.gitignore` (already done)
   - Don't commit secrets to version control

2. **Production:**
   - Remove or don't create `.env` file
   - Use Docker secrets (swarm mode) or file-based secrets
   - Change default passwords after first boot
   - Restrict access to `secrets/` directory

3. **Changing Secrets:**
   - Delete the initialization flag: `docker volume rm roomsense_roomsense_init`
   - Or manually update secrets and restart containers
   - For `.env` file: Just edit and restart

## Troubleshooting

### Secrets Not Generated

**Problem:** Secrets are not created on first boot

**Solution:**
1. Check if initialization flag exists: `docker compose exec webserver ls -la /var/lib/roomsense/`
2. Remove flag to force re-initialization: `docker volume rm roomsense_roomsense_init`
3. Check logs: `docker compose logs webserver`

### .env File Not Loaded

**Problem:** `.env` file exists but variables aren't loaded

**Solution:**
1. Ensure `.env` file is in `webserver/` directory
2. Check file permissions: `ls -la webserver/.env`
3. Verify syntax (no spaces around `=`)
4. Check logs for loading messages

### Missing SESSION_SECRET Error

**Problem:** Application fails with "SESSION_SECRET is not set"

**Solution:**
1. Ensure `.env` file has `SESSION_SECRET` set, OR
2. Ensure secrets are initialized (check `webserver/secrets/` or Docker secrets)
3. Restart container: `docker compose restart webserver`

### Resetting to First Boot

To force re-initialization:

```bash
# Stop containers
docker compose down

# Remove initialization flag volume
docker volume rm roomsense_roomsense_init

# Remove secrets (if using file-based)
rm -rf webserver/secrets/*

# Start containers (will re-initialize)
docker compose up -d
```

## File Structure

```
webserver/
├── .env                    # Optional: Environment file (highest priority)
├── scripts/
│   ├── init-secrets.sh     # Generates secrets on first boot
│   ├── load-env.sh         # Loads environment variables
│   └── start.sh            # Main startup script
├── secrets/                 # File-based secrets (non-swarm mode)
│   ├── session_secret
│   ├── pgpassword
│   ├── influx_password
│   └── influx_token
└── compose.yaml            # Docker Compose configuration
```

## Default Values

If no `.env` file and no secrets exist, these defaults are used:

| Variable | Default Value |
|----------|--------------|
| `PGHOST` | `postgres` |
| `PGUSER` | `postgres` |
| `PGPASSWORD` | `password` (generated as secret) |
| `PGPORT` | `5432` |
| `PGDATABASE` | `user` |
| `INFLUX_USERNAME` | `admin` |
| `INFLUX_PASSWORD` | `admin123` (generated as secret) |
| `INFLUX_ORG` | `RoomSense` |
| `INFLUX_BUCKET` | `sensors_data` |
| `INFLUX_TOKEN` | Generated (128-char hex) |
| `INFLUX_URL` | `https://influxdb:8086` |
| `MQTT_BROKER` | `localhost` |
| `MQTT_PORT` | `1883` |
| `BLE_GATEWAY_URL` | `http://host.docker.internal:8080` |
| `SESSION_SECRET` | Generated (128-char hex) |
| `DEV_BYPASS_AUTH` | `0` |
| `TRUST_PROXY` | `0` |
| `RATE_LIMIT_TRUST_PROXY` | `0` |
| `PERM_CACHE_MS` | `30000` |

## Examples

### Example 1: First Boot Without .env

```bash
# No .env file exists
cd webserver
docker compose up -d

# Container will:
# 1. Detect first boot (no initialization flag)
# 2. Generate secrets automatically
# 3. Store in webserver/secrets/ (or Docker secrets)
# 4. Load environment from secrets
# 5. Start application
```

### Example 2: Using .env File

```bash
# Create .env file
cat > webserver/.env << EOF
SESSION_SECRET=my-custom-secret
PGPASSWORD=my-db-password
INFLUX_TOKEN=my-influx-token
EOF

# Start containers
docker compose up -d

# Container will:
# 1. Load all variables from .env
# 2. Skip secret generation (not needed)
# 3. Start application
```

### Example 3: Production with Docker Secrets

```bash
# Initialize Docker Swarm
docker swarm init

# Create secrets manually
echo "production-secret" | docker secret create session_secret -
echo "secure-password" | docker secret create pgpassword -

# Deploy stack
docker stack deploy -c compose.yaml roomsense
```

## See Also

- [ENV_RASPBERRY_PI.md](./ENV_RASPBERRY_PI.md) - Raspberry Pi specific configuration
- [README_ENV.md](./README_ENV.md) - General environment variable guide

