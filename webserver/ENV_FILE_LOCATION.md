# .env File Location

## Where to Place Your .env File

The `.env` file should be located in the **root of the webserver directory** (same directory as `compose.yaml`):

```
webserver/
├── .env                    ← HERE (same level as compose.yaml)
├── compose.yaml
├── Dockerfile
├── package.json
├── src/
├── scripts/
└── ...
```

## How It Works

1. **Host location**: `webserver/.env` (root of the project)
2. **Container mount**: The compose.yaml mounts it as `./.env:/webserver/.env:ro`
3. **Application reads**: The app looks for `.env` in `/webserver/.env` (which is the current working directory)

## Volume Mount Configuration

In `compose.yaml`, the webserver service has:
```yaml
volumes:
  - ./.env:/webserver/.env:ro
  - ./certs:/webserver/certs:ro
```

This means:
- `./.env` = relative to where `docker stack deploy` is run (webserver root)
- `/webserver/.env` = inside the container (where the app runs)

## What Goes in .env

**Non-sensitive configuration only:**
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
MQTT_BROKER=mosquitto
MQTT_PORT=1883

# Application Configuration
BLE_GATEWAY_URL=http://host.docker.internal:8080
DEV_BYPASS_AUTH=0
TRUST_PROXY=0
RATE_LIMIT_TRUST_PROXY=0
PERM_CACHE_MS=30000
```

**DO NOT put these in .env** (they're managed by Docker Swarm secrets):
- `SESSION_SECRET`
- `PGPASSWORD`
- `INFLUX_PASSWORD`
- `INFLUX_TOKEN`

## Verification

To verify your .env file is in the correct location:

```powershell
# Should show the .env file
Get-Item .env

# Should be in the same directory as compose.yaml
Test-Path .env
Test-Path compose.yaml
```

Both should return `True` if the .env file is in the correct location.

