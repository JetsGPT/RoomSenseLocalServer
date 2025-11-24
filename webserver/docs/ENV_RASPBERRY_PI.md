# Environment Variables for Raspberry Pi Docker Setup

This guide shows the correct environment variables for running RoomSense on a Raspberry Pi with Docker containers, including BLE communication and MQTT.

## Important: Network Configuration for Raspberry Pi

For BLE to work on Raspberry Pi, the `blegateway` container **must use host networking**. This means:

1. **Uncomment** `network_mode: host` in `compose.yaml` (line 92)
2. **Comment out** the `ports:` section for blegateway (lines 80-81)
3. **Update environment variables** as shown below

## Complete .env File for Raspberry Pi

```env
# ============================================
# SESSION SECURITY (REQUIRED)
# ============================================
SESSION_SECRET=cffba429a3eb60658adb4d5870f16de4afbb6affa675aa75db8e99ef06af4982caaf4e87e0b320195415e455e4ea1b10f6c0e76ec43be1234cdfa1d48c9e2f94

# ============================================
# INFLUXDB CONFIGURATION (REQUIRED)
# ============================================
# Initial setup credentials (used only during first initialization)
INFLUX_USERNAME=admin
INFLUX_PASSWORD=admin123

# InfluxDB connection details (get these after initial setup)
INFLUX_ORG=RoomSense
INFLUX_BUCKET=sensors_data
INFLUX_TOKEN=adminToken
INFLUX_URL=https://influxdb:8086

# ============================================
# POSTGRESQL CONFIGURATION
# ============================================
PGHOST=postgres
PGUSER=postgres
PGPASSWORD=password
PGPORT=5432
PGDATABASE=user

# ============================================
# MQTT CONFIGURATION
# ============================================
# For blegateway with host networking: use 'localhost' (not 'mosquitto')
# Because blegateway uses host networking, it can't use Docker service names
MQTT_BROKER=localhost
MQTT_PORT=1883

# ============================================
# BLE GATEWAY CONFIGURATION
# ============================================
# For Raspberry Pi with host networking:
# - blegateway runs on host network at localhost:8080
# - webserver container needs to reach it via host.docker.internal
BLE_GATEWAY_URL=http://host.docker.internal:8080

# ============================================
# OPTIONAL CONFIGURATION
# ============================================
# Development mode (set to 0 in production!)
DEV_BYPASS_AUTH=0

# Proxy settings (set to 1 if behind reverse proxy)
TRUST_PROXY=0
RATE_LIMIT_TRUST_PROXY=0

# Permission cache duration in milliseconds
PERM_CACHE_MS=30000
```

## Key Differences for Raspberry Pi

### 1. MQTT_BROKER
- **Your current value:** `mosquitto` ❌
- **Raspberry Pi value:** `localhost` ✅
- **Why:** When `blegateway` uses `network_mode: host`, it can't resolve Docker service names. Since `mosquitto` exposes port 1883 on the host, use `localhost:1883`.

### 2. BLE_GATEWAY_URL
- **Your current value:** `http://blegateway:8080` ❌
- **Raspberry Pi value:** `http://host.docker.internal:8080` ✅
- **Why:** The `webserver` container (which uses Docker bridge network) needs to reach `blegateway` (which uses host network) via the special `host.docker.internal` hostname.

### 3. INFLUX_URL
- **Your current value:** `https://influxdb:8086` ✅
- **This is correct!** The `webserver` container can use Docker service names because it's on the bridge network.

## Setup Steps for Raspberry Pi

1. **Update compose.yaml:**
   ```yaml
   blegateway:
     # ... other config ...
     # Comment out ports when using host networking:
     # ports:
     #   - "8080:8080"
     # Uncomment for Raspberry Pi:
     network_mode: host
   ```

2. **Create/update .env file** with the values above

3. **Start containers:**
   ```bash
   cd webserver
   docker compose down
   docker compose up -d
   ```

4. **Verify BLE gateway is accessible:**
   ```bash
   # From Raspberry Pi host
   curl http://localhost:8080/health
   
   # From webserver container
   docker compose exec webserver curl http://host.docker.internal:8080/health
   ```

5. **Check logs:**
   ```bash
   docker compose logs blegateway
   docker compose logs webserver
   ```

## Troubleshooting

### BLE Gateway can't connect to MQTT
**Error:** `Connection refused` or `Name or service not known`

**Solution:** 
- Ensure `MQTT_BROKER=localhost` (not `mosquitto`)
- Verify mosquitto is running: `docker compose ps mosquitto`
- Check mosquitto port is exposed: `netstat -tuln | grep 1883`

### Webserver can't reach BLE Gateway
**Error:** `ECONNREFUSED` or `getaddrinfo ENOTFOUND`

**Solution:**
- Ensure `BLE_GATEWAY_URL=http://host.docker.internal:8080`
- Verify `extra_hosts` is set in compose.yaml (it should be)
- Test from webserver container: `docker compose exec webserver curl http://host.docker.internal:8080/health`

### BLE scan fails
**Error:** `No such file or directory` or `Bluetooth adapter not available`

**Solution:**
- Ensure `network_mode: host` is uncommented
- Verify Bluetooth is enabled on Raspberry Pi: `bluetoothctl show`
- Check D-Bus volumes are mounted (should be automatic)
- Restart blegateway: `docker compose restart blegateway`

## Alternative: If You Want to Keep Docker Network

If you prefer to keep everything on Docker network (not recommended for Pi, but possible):

1. **Keep blegateway on bridge network** (don't use `network_mode: host`)
2. **Use these values:**
   ```env
   MQTT_BROKER=mosquitto
   BLE_GATEWAY_URL=http://blegateway:8080
   ```
3. **Note:** BLE may not work reliably without host networking on Raspberry Pi

## Summary

For **Raspberry Pi with host networking** (recommended):
- ✅ `MQTT_BROKER=localhost`
- ✅ `BLE_GATEWAY_URL=http://host.docker.internal:8080`
- ✅ `INFLUX_URL=https://influxdb:8086` (unchanged)
- ✅ All other variables remain the same

Your current `.env` is almost correct - just update `MQTT_BROKER` and `BLE_GATEWAY_URL` as shown above!

