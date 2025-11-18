# Environment Variables Setup Guide

This document explains all environment variables needed for the RoomSense Local Server project.

## Quick Start

1. Copy the example file:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and fill in your values (see sections below)

3. The `.env` file is automatically loaded by Docker Compose

## Required Variables

### 🔴 Critical - Must Set

- **SESSION_SECRET**: Required for Express session security
  - Generate with: `openssl rand -base64 32`
  - Or use any long random string

- **INFLUX_TOKEN**: Your InfluxDB admin token
  - Get from InfluxDB UI or create during setup

- **INFLUX_ORG**: Your InfluxDB organization name
  - Created during InfluxDB initialization

- **INFLUX_BUCKET**: Your InfluxDB bucket name
  - Created during InfluxDB initialization

### 🟡 Important - Should Set

- **INFLUX_URL**: InfluxDB connection URL
  - Default: `https://influxdb:8086` (works within Docker network)
  - For external access, use your actual URL

- **INFLUX_USERNAME** / **INFLUX_PASSWORD**: For InfluxDB initialization
  - Only needed for first-time setup
  - Used to create admin user

- **BLE_GATEWAY_URL**: URL to access BLE Gateway API
  - Default: `http://localhost:8080` (with host networking)
  - Change if using different port or network setup

### 🟢 Optional - Has Defaults

All other variables have sensible defaults and can be left as-is for basic setup.

## Variable Categories

### PostgreSQL
- Used by: `webserver` container
- Defaults are set in `compose.yaml`
- Only override if you need custom database settings

### InfluxDB
- Used by: `webserver`, `influxdb`, `telegraf` containers
- **Required** for sensor data storage
- Set up InfluxDB first, then get token/org/bucket values

### MQTT
- Used by: `blegateway` container
- Default: `localhost:1883` (works with host networking)
- Only change if using external MQTT broker

### BLE Gateway
- Used by: `webserver` container (to connect to `blegateway`)
- Default: `http://localhost:8080`
- Must match the port where blegateway is running

### Security
- **SESSION_SECRET**: Required for session encryption
- **DEV_BYPASS_AUTH**: Set to `1` to bypass authentication (development only!)

### Network/Proxy
- **TRUST_PROXY**: Set to `1` if behind reverse proxy
- **RATE_LIMIT_TRUST_PROXY**: Set to `1` if behind proxy for rate limiting

## First-Time Setup Checklist

1. ✅ Generate `SESSION_SECRET`
2. ✅ Set `INFLUX_USERNAME` and `INFLUX_PASSWORD` (for initialization)
3. ✅ Start containers: `docker compose up -d`
4. ✅ Access InfluxDB UI at `http://localhost:8086`
5. ✅ Create organization and bucket in InfluxDB
6. ✅ Get admin token from InfluxDB
7. ✅ Update `.env` with `INFLUX_TOKEN`, `INFLUX_ORG`, `INFLUX_BUCKET`
8. ✅ Restart containers: `docker compose restart webserver telegraf`

## Testing Your Setup

After setting up `.env`, verify everything works:

```bash
# Check if containers are running
docker compose ps

# Check webserver logs
docker compose logs webserver

# Check BLE gateway logs
docker compose logs blegateway

# Test BLE scan endpoint
curl http://localhost:8080/scan
```

## Security Notes

⚠️ **Never commit `.env` to git!** It's already in `.gitignore`

⚠️ **Change default passwords** in production:
- PostgreSQL password
- InfluxDB password
- Session secret

⚠️ **Set `DEV_BYPASS_AUTH=0`** in production

## Troubleshooting

### "Cannot connect to InfluxDB"
- Check `INFLUX_URL` is correct
- Verify `INFLUX_TOKEN` is valid
- Ensure InfluxDB container is running

### "BLE Gateway unavailable"
- Check `BLE_GATEWAY_URL` matches blegateway port
- Verify blegateway container is running
- Check logs: `docker compose logs blegateway`

### "Session errors"
- Ensure `SESSION_SECRET` is set
- Restart webserver after changing `SESSION_SECRET`

