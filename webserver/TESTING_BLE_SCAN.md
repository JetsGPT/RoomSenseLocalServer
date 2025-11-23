# Testing Guide: BLE Device Scan Endpoint

## Prerequisites

1. **Start Docker services:**
   ```bash
   cd webserver
   docker-compose up -d
   ```

2. **Verify services are running:**
   ```bash
   docker-compose ps
   ```
   You should see:
   - `webserver` (running)
   - `blegateway` (running)
   - `mosquitto` (running)
   - `postgres` (running)

3. **Check BLE gateway logs:**
   ```bash
   docker-compose logs blegateway
   ```
   Look for: `Starting BLE Gateway HTTP API on 0.0.0.0:8080`

## Test Scenarios

### 1. Test Authentication (Unauthorized Access)

**Test without login:**
```bash
curl -k -X GET https://localhost:8081/api/devices/scan
```

**Expected Response:**
```json
{
  "error": "You must be logged in"
}
```
**Status:** `401 Unauthorized`

---

### 2. Test with Authentication

**Step 1: Login to get session cookie**
```bash
# Replace with your actual credentials
curl -k -c cookies.txt -X POST https://localhost:8081/api/users/login \
  -H "Content-Type: application/json" \
  -d '{"username": "your-username", "password": "your-password"}'
```

**Step 2: Test scan endpoint with session cookie**
```bash
curl -k -b cookies.txt -X GET https://localhost:8081/api/devices/scan
```

**Expected Responses:**

**If devices found:**
```json
[
  {
    "address": "XX:XX:XX:XX:XX:XX",
    "name": "TempSensor01"
  },
  {
    "address": "YY:YY:YY:YY:YY:YY",
    "name": "TempSensor02"
  }
]
```
**Status:** `200 OK`

**If no devices found:**
```json
[]
```
**Status:** `200 OK`

---

### 3. Test BLE Gateway Health Check

**Direct test of Python API (bypassing Express):**
```bash
# From host machine
curl http://localhost:8080/health

# Or from within Docker network
docker-compose exec webserver curl http://blegateway:8080/health
```

**Expected Response:**
```json
{
  "status": "ok",
  "bridge_initialized": true
}
```

---

### 4. Test Error Scenarios

#### A. BLE Gateway Not Available

**Stop the BLE gateway:**
```bash
docker-compose stop blegateway
```

**Test scan endpoint:**
```bash
curl -k -b cookies.txt -X GET https://localhost:8081/api/devices/scan
```

**Expected Response:**
```json
{
  "error": "BLE bridge unavailable",
  "detail": "Cannot connect to BLE gateway container. Ensure it is running and accessible."
}
```
**Status:** `503 Service Unavailable`

**Restart gateway:**
```bash
docker-compose start blegateway
```

#### B. Timeout Test

The scan has a 10-second timeout. If scanning takes longer, you'll get:

**Expected Response:**
```json
{
  "error": "BLE scan timed out",
  "detail": "Scan operation exceeded 10 seconds"
}
```
**Status:** `504 Gateway Timeout`

---

### 5. Using Postman/Thunder Client

1. **Create a new request:**
   - Method: `GET`
   - URL: `https://localhost:8081/api/devices/scan`

2. **Add authentication:**
   - Go to "Cookies" tab
   - Add cookie from your browser session, OR
   - Use "Authorization" with session cookie in headers:
     ```
     Cookie: connect.sid=your-session-id
     ```

3. **Disable SSL verification** (for self-signed cert):
   - Settings → SSL certificate verification: OFF

4. **Send request**

---

### 6. Using Browser DevTools

1. **Open browser console** (F12)
2. **Navigate to your app** (must be logged in)
3. **Run in console:**
   ```javascript
   fetch('https://localhost:8081/api/devices/scan', {
     credentials: 'include'  // Include session cookie
   })
   .then(res => res.json())
   .then(data => console.log(data))
   .catch(err => console.error(err));
   ```

---

### 7. Check Logs for Debugging

**Express server logs:**
```bash
docker-compose logs -f webserver
```

**BLE gateway logs:**
```bash
docker-compose logs -f blegateway
```

**Look for:**
- `Scanning for devices...`
- `Found candidate: ...`
- Any error messages

---

## Expected Behavior on Different Platforms

### On Raspberry Pi (with BLE hardware):
- ✅ Should discover BLE devices
- ✅ Returns filtered ESP devices
- ✅ Works with privileged Docker container

### On Laptop/Development Machine:
- ⚠️ BLE may not work in Docker (hardware access limitations)
- ⚠️ May return empty array `[]`
- ✅ API structure works correctly
- ✅ Error handling works correctly

---

## Troubleshooting

### Issue: "BLE bridge unavailable" (503)

**Solutions:**
1. Check if blegateway container is running:
   ```bash
   docker-compose ps blegateway
   ```

2. Check blegateway logs:
   ```bash
   docker-compose logs blegateway
   ```

3. Verify network connectivity:
   ```bash
   docker-compose exec webserver ping blegateway
   ```

4. Check if port 8080 is accessible:
   ```bash
   docker-compose exec webserver curl http://blegateway:8080/health
   ```

### Issue: "Request timeout" (504)

**Solutions:**
1. BLE scan is taking too long (>10 seconds)
2. Check if BLE hardware is accessible
3. On Raspberry Pi, verify Bluetooth is enabled:
   ```bash
   bluetoothctl show
   ```

### Issue: Empty array returned

**Possible causes:**
1. No ESP devices nearby
2. Devices not advertising with correct service UUID
3. BLE hardware not accessible in Docker (laptop/Windows)
4. Bluetooth adapter not properly mounted

**Check:**
```bash
# On Raspberry Pi, check if Bluetooth is working
docker-compose exec blegateway python -c "from bleak import BleakScanner; import asyncio; print(asyncio.run(BleakScanner.discover()))"
```

### Issue: Authentication fails

**Solutions:**
1. Ensure you're logged in first
2. Check session cookie is being sent
3. Verify `SESSION_SECRET` is set in `.env`
4. Check session store (PostgreSQL) is accessible

---

## Quick Test Script

Save this as `test_ble_scan.sh`:

```bash
#!/bin/bash

BASE_URL="https://localhost:8081"
COOKIE_FILE="cookies.txt"

echo "1. Logging in..."
curl -k -c $COOKIE_FILE -X POST $BASE_URL/api/users/login \
  -H "Content-Type: application/json" \
  -d '{"username": "your-username", "password": "your-password"}'

echo -e "\n\n2. Testing BLE scan endpoint..."
curl -k -b $COOKIE_FILE -X GET $BASE_URL/api/devices/scan | jq .

echo -e "\n\n3. Testing health check..."
curl -k http://localhost:8080/health | jq .

echo -e "\n\nDone!"
```

Make it executable:
```bash
chmod +x test_ble_scan.sh
./test_ble_scan.sh
```

---

## Success Criteria

✅ **Endpoint is accessible:** Returns 401 without auth, 200 with auth  
✅ **Authentication works:** Requires login  
✅ **Timeout enforced:** Returns 504 if scan > 10 seconds  
✅ **Error handling:** Returns appropriate errors (503, 504, 502)  
✅ **Empty results:** Returns `[]` if no devices found  
✅ **Device filtering:** Only returns ESP devices (matching service UUID or target name)  
✅ **Response format:** Returns JSON array with `address` and `name` fields  

