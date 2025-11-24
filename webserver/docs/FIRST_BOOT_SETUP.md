# First Boot Setup - Quick Start

## What Was Implemented

A complete first-boot initialization system that:

1. **Uses `.env` file if it exists** (highest priority)
2. **Generates secrets on first boot** if `.env` doesn't exist
3. **Stores secure values as Docker secrets** (or file-based secrets)
4. **Only runs on first boot** (tracked by initialization flag)

## Quick Start

### Option 1: Use .env File (Development)

Create `webserver/.env` with your configuration:

```env
SESSION_SECRET=your-secret-here
PGPASSWORD=your-password
INFLUX_TOKEN=your-token
# ... other variables
```

Start containers:
```bash
cd webserver
docker compose up -d
```

### Option 2: Automatic First Boot (Production)

**No `.env` file needed!** Just start the containers:

```bash
cd webserver
docker compose up -d
```

On first boot, the system will:
- ✅ Generate `SESSION_SECRET` (128-char random)
- ✅ Create `pgpassword` secret (default: "password")
- ✅ Create `influx_password` secret (default: "admin123")
- ✅ Generate `influx_token` (128-char random)
- ✅ Store in `webserver/secrets/` directory
- ✅ Load all environment variables
- ✅ Start the application

## Files Created

- `webserver/scripts/init-secrets.sh` - Generates secrets on first boot
- `webserver/scripts/load-env.sh` - Loads environment variables
- `webserver/scripts/start.sh` - Main startup script
- `webserver/INITIALIZATION.md` - Complete documentation
- `webserver/secrets/` - Directory for file-based secrets (auto-created)

## Configuration Priority

1. **`.env` file** (if exists) - Highest priority
2. **Docker secrets** (if variable not in `.env`)
3. **compose.yaml defaults**
4. **Hardcoded defaults**

## Security

- Secrets are stored with 600 permissions (owner read/write only)
- `.env` and `secrets/` are in `.gitignore`
- Sensitive values are never logged
- Docker secrets supported (swarm mode) or file-based (compose mode)

## Changing Secrets

To regenerate secrets:

```bash
# Stop containers
docker compose down

# Remove initialization flag
docker volume rm roomsense_roomsense_init

# Remove old secrets (optional)
rm -rf webserver/secrets/*

# Start containers (will re-initialize)
docker compose up -d
```

## See Also

- [INITIALIZATION.md](./INITIALIZATION.md) - Complete documentation
- [ENV_RASPBERRY_PI.md](./ENV_RASPBERRY_PI.md) - Raspberry Pi specific config

