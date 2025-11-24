# BLE in Docker - Solutions Guide

## Problem
BLE (Bluetooth Low Energy) doesn't work in Docker containers on Windows/Mac because Docker Desktop runs in a VM without direct hardware access.

## Solutions (Choose Based on Your Platform)

---

## Solution 1: Use Host Networking (Linux/Raspberry Pi Only) ⭐ RECOMMENDED FOR PI

**Best for:** Raspberry Pi or native Linux systems

**How it works:** Container uses the host's network stack directly, giving full access to Bluetooth hardware.

### Steps:

1. **Uncomment `network_mode: host` in compose.yaml:**
   ```yaml
   blegateway:
     network_mode: host  # Uncomment this line
   ```

2. **Remove port mapping** (not needed with host networking):
   ```yaml
   # ports:
   #   - "8080:8080"  # Comment this out
   ```

3. **Update BLE_GATEWAY_URL in .env:**
   ```env
   BLE_GATEWAY_URL=http://localhost:8080
   ```

4. **Restart:**
   ```bash
   docker-compose down
   docker-compose up -d
   ```

**Pros:**
- ✅ Direct hardware access
- ✅ Works reliably on Raspberry Pi
- ✅ No port mapping needed

**Cons:**
- ❌ Only works on Linux (not Windows/Mac Docker Desktop)
- ❌ Container can't use service names (must use localhost)

---

## Solution 2: Run BLE Bridge on Host (Windows/Mac) ⭐ RECOMMENDED FOR DEVELOPMENT

**Best for:** Windows/Mac development, testing before deploying to Pi

**How it works:** Run the Python BLE bridge directly on your host machine (outside Docker), connect via HTTP.

### Steps:

1. **Install Python dependencies on host:**
   ```bash
   cd webserver/bletomqtt
   pip install -r requirements.txt
   ```

2. **Run BLE bridge on host:**
   ```bash
   python main.py
   ```

3. **Update Express to connect to host:**
   In `webserver/routes/devices.js`, change:
   ```javascript
   const BLE_GATEWAY_URL = process.env.BLE_GATEWAY_URL || 'http://host.docker.internal:8080';
   ```

4. **Or set in .env:**
   ```env
   BLE_GATEWAY_URL=http://host.docker.internal:8080
   ```

5. **Stop Docker blegateway service:**
   ```yaml
   # Comment out in compose.yaml:
   # blegateway:
   #   ...
   ```

**Pros:**
- ✅ Works on Windows/Mac
- ✅ Direct Bluetooth access
- ✅ Easy to debug

**Cons:**
- ❌ Requires Python on host
- ❌ Not containerized
- ❌ Need to manage two processes

---

## Solution 3: USB Bluetooth Dongle Passthrough (Windows/Mac)

**Best for:** Windows/Mac with USB Bluetooth adapter

**How it works:** Pass USB Bluetooth dongle directly to container.

### Steps:

1. **Find your Bluetooth adapter:**
   - Windows: Device Manager → Bluetooth → Note COM port
   - Mac: `ls /dev/cu.*` or `system_profiler SPUSBDataType`

2. **Use USB device passthrough:**
   ```yaml
   blegateway:
     devices:
       - /dev/ttyUSB0:/dev/ttyUSB0  # Adjust based on your adapter
     # Or use USB passthrough:
     # devices:
     #   - /dev/bus/usb:/dev/bus/usb
   ```

3. **On Windows, you may need WSL2:**
   - Use WSL2 instead of Docker Desktop
   - Or use Linux container with USB passthrough

**Pros:**
- ✅ Works with USB adapters
- ✅ Can work on Windows/Mac

**Cons:**
- ❌ Complex setup
- ❌ May not work with built-in Bluetooth
- ❌ Requires specific hardware

---

## Solution 4: WSL2 with Docker (Windows)

**Best for:** Windows users who can use WSL2

**How it works:** Use WSL2 (Windows Subsystem for Linux) which has better hardware access.

### Steps:

1. **Install WSL2:**
   ```powershell
   wsl --install
   ```

2. **Install Docker in WSL2:**
   ```bash
   # In WSL2 terminal
   sudo apt update
   sudo apt install docker.io docker-compose
   ```

3. **Use host networking in WSL2:**
   ```yaml
   blegateway:
     network_mode: host
   ```

**Pros:**
- ✅ Better hardware access than Docker Desktop
- ✅ Native Linux environment

**Cons:**
- ❌ Requires WSL2 setup
- ❌ Still may have limitations

---

## Solution 5: Use Docker Desktop with WSL2 Backend (Windows)

**Best for:** Windows users already using Docker Desktop

### Steps:

1. **Switch Docker Desktop to WSL2 backend:**
   - Docker Desktop → Settings → General → Use WSL 2 based engine

2. **Enable WSL integration:**
   - Settings → Resources → WSL Integration → Enable for your distro

3. **Run in WSL2 terminal:**
   ```bash
   cd /mnt/c/Users/erayy/Documents/GitHub/RoomSenseLocalServer/webserver
   docker-compose up -d
   ```

**Pros:**
- ✅ Uses existing Docker Desktop
- ✅ Better than Hyper-V backend

**Cons:**
- ❌ Still may have Bluetooth limitations

---

## Recommended Approach by Platform

### 🍓 Raspberry Pi (Production)
**Use Solution 1 (Host Networking)**
- Most reliable
- Direct hardware access
- Best performance

### 💻 Windows/Mac (Development)
**Use Solution 2 (Run on Host)**
- Easiest to set up
- Works immediately
- Good for testing API structure

### 🐧 Native Linux (Development)
**Use Solution 1 (Host Networking)**
- Same as Raspberry Pi
- Works perfectly

---

## Testing Which Solution Works

Run this in your container to check Bluetooth availability:

```bash
docker-compose exec blegateway python -c "
import sys
try:
    from bleak import BleakScanner
    import asyncio
    async def test():
        try:
            devices = await BleakScanner.discover(timeout=2)
            print(f'✅ BLE works! Found {len(devices)} devices')
        except Exception as e:
            print(f'❌ BLE error: {e}')
    asyncio.run(test())
except Exception as e:
    print(f'❌ Import error: {e}')
"
```

---

## Current Configuration Status

✅ **Already configured:**
- BlueZ installed in container
- Privileged mode enabled
- D-Bus mounted
- Device access granted
- Required capabilities added

⚠️ **Still needs:**
- Host networking (for Linux/Pi) OR
- Run on host (for Windows/Mac)

---

## Quick Fix for Raspberry Pi

Just uncomment this line in `compose.yaml`:

```yaml
blegateway:
  network_mode: host  # <-- Uncomment this
```

Then restart:
```bash
docker-compose down && docker-compose up -d
```

