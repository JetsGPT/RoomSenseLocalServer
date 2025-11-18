change the project to work with this bletomqtt

script

#!/usr/bin/env python3
import sys
import asyncio
import logging
import struct
from typing import Dict, Optional, List

# ---- Windows event loop for Bleak ----
if sys.platform.startswith("win"):
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from bleak import BleakClient, BleakScanner, BleakError
from bleak.backends.device import BLEDevice
import aiomqtt
import json
import time
import os
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
import uvicorn
from contextlib import asynccontextmanager

# ---------- Configuration ----------
CUSTOM_SERVICE_UUID = "cfa59c64-aeaf-42ac-bf8d-bc4a41ef5b0c".lower()
CUSTOM_SENSOR_CHAR_UUID = "49c92b70-42f5-49c3-bc38-5fe05b3df8e0".lower()
CUSTOM_SENSOR_TYPE_DESC_UUID = "3bee5811-4c6c-449a-b368-0b1391c6c1dc".lower()
CUSTOM_BOX_CHAR_UUID = "9d62dc0c-b4ef-40c4-9383-15bdc16870de".lower()

TARGET_NAME_PREFIX = "RoomSense-"

SCAN_DURATION = 8.0
# SCAN_INTERVAL is no longer needed, scans are on-demand
MQTT_BROKER = os.getenv("MQTT_BROKER", "localhost")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
MQTT_TOPIC_BASE = "ble/devices"
MQTT_USERNAME = None
MQTT_PASSWORD = None

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s: %(message)s")
log = logging.getLogger("ble_gateway")


# ================================================================
# BLEPeripheral Class (Mostly Unchanged)
# ================================================================
class BLEPeripheral:
    """Handles the connection and data-forwarding for a single BLE device."""
    def __init__(self, device: BLEDevice, name: str, mqtt_client: aiomqtt.Client): # <-- CHANGED: Type hint
        self.device = device
        self.address = device.address
        self.name = name or "unknown"
        self.client: Optional[BleakClient] = None
        self.mqtt = mqtt_client
        self._task: Optional[asyncio.Task] = None
        self._stopping = False
        self.box_address: Optional[str] = None

    async def _read_metadata(self):
        """Read static device info like the box address."""
        try:
            box = await self.client.read_gatt_char(CUSTOM_BOX_CHAR_UUID)
            self.box_address = box.decode(errors="ignore").strip() or None
            log.info("[%s] Successfully read box_address: %r", self.address, self.box_address)
        except Exception as e:
            log.warning("[%s] Box char read skipped/failed: %s", self.address, e)
        log.info("[%s] Metadata box_address=%r", self.address, self.box_address)

    async def _get_sensor_type_from_descriptor(self) -> Optional[str]:
        """Read the descriptor attached to the sensor characteristic that contains the sensor type."""
        try:
            descriptors = await self.client.get_descriptors(CUSTOM_SENSOR_CHAR_UUID)
            if not descriptors:
                log.debug("[%s] No descriptors found for sensor char", self.address)
                return None
            target_desc = next(
                (d for d in descriptors if d.uuid.lower() == CUSTOM_SENSOR_TYPE_DESC_UUID),
                None,
            )
            if not target_desc:
                log.debug("[%s] Sensor type descriptor not found (uuid=%s)", self.address, CUSTOM_SENSOR_TYPE_DESC_UUID)
                return None
            data = await self.client.read_gatt_descriptor(target_desc.handle)
            sensor_type = data.decode("utf-8", errors="ignore").strip()
            return sensor_type or None
        except Exception:
            return None

    def _parse_sensor_data(self, data: bytes, sensor_type_hint: Optional[str] = None):
        """Parse sensor value from notification payload."""
        if not data:
            return None, None
        try:
            json_str = data.decode("utf-8").strip()
            parsed = json.loads(json_str)
            sensor_type = parsed.get("type", sensor_type_hint or "unknown")
            value = parsed.get("value")
            return sensor_type, value
        except (json.JSONDecodeError, UnicodeDecodeError):
            pass
        try:
            if len(data) == 4:
                value = round(struct.unpack("<f", data)[0], 3)
            elif len(data) == 2:
                value = struct.unpack("<h", data)[0]
            elif len(data) == 8:
                value = struct.unpack("<d", data)[0]
            else:
                value = int.from_bytes(data, "little", signed=True)
            return sensor_type_hint or "unknown", value
        except Exception:
            try:
                value = float(data.decode().strip())
                return sensor_type_hint or "unknown", value
            except Exception:
                return None, None

    async def _on_notify(self, _handle: int, data: bytearray):
        """Handle notifications from the sensor data characteristic."""
        sensor_type = await self._get_sensor_type_from_descriptor()
        sensor_type, value = self._parse_sensor_data(data, sensor_type_hint=sensor_type)
        if sensor_type is None or value is None:
            log.warning("[%s] Failed to parse sensor data", self.address)
            return

        payload = {
            "sensor_box": self.box_address or "unknown",
            "sensor_type": sensor_type,
            "value": value,
            "ts": int(time.time() * 1000),
        }
        topic_id = (self.box_address or self.address.replace(":", "").lower())
        topic = f"{MQTT_TOPIC_BASE}/{topic_id}"
        try:
            await self.mqtt.publish(topic, json.dumps(payload).encode("utf-8"))
            log.info("[%s] notify MQTT %s : %s", self.address, topic, payload)
        except aiomqtt.MqttError as e:
            log.warning("[%s] MQTT publish error: %s", self.address, e)
        except Exception as e:
            log.warning("[%s] Unknown error publishing to MQTT: %s", self.address, e)


    async def connect_and_listen(self):
        """Main connection loop for this peripheral."""
        backoff = 1
        while not self._stopping:
            try:
                self.client = BleakClient(self.device, timeout=10.0)
                log.info("[%s] Connecting...", self.address)
                await self.client.connect()
                log.info("[%s] Connected", self.address)

                def _on_disconnect(_client):
                    log.warning("[%s] Disconnected.", self.address)
                self.client.disconnected_callback = _on_disconnect

                await self._read_metadata()
                await self.client.start_notify(CUSTOM_SENSOR_CHAR_UUID, self._on_notify)
                log.info("[%s] Subscribed to sensor values: %s", self.address, CUSTOM_SENSOR_CHAR_UUID)

                backoff = 1
                while self.client.is_connected and not self._stopping:
                    await asyncio.sleep(1.0)

                try:
                    if self.client.is_connected:
                        await self.client.stop_notify(CUSTOM_SENSOR_CHAR_UUID)
                except Exception:
                    pass
                try:
                    await self.client.disconnect()
                except Exception:
                    pass

                if self._stopping:
                    break

                log.warning("[%s] Reconnecting after %s sec", self.address, backoff)
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30)
            
            except (BleakError, asyncio.TimeoutError) as e:
                log.warning("[%s] BLE error: %s", self.address, e)
                if self._stopping:
                    break
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30)
            except Exception as e:
                log.error("[%s] Unhandled exception in connection loop: %s", self.address, e)
                if self._stopping:
                    break
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30)
        
        log.info("[%s] Connection task finished.", self.address)

    def start(self):
        """Starts the connection task in the background."""
        self._task = asyncio.create_task(self.connect_and_listen())

    async def stop(self):
        """Stops the connection task."""
        log.info("[%s] Stopping connection...", self.address)
        self._stopping = True
        
        if self.client and self.client.is_connected:
            try:
                await self.client.stop_notify(CUSTOM_SENSOR_CHAR_UUID)
            except Exception:
                pass
            try:
                await self.client.disconnect()
            except Exception:
                pass
        
        if self._task:
            try:
                await asyncio.wait_for(self._task, timeout=5.0)
            except asyncio.TimeoutError:
                log.warning("[%s] Stop task timed out.", self.address)
                self._task.cancel()
            except Exception:
                pass # Task already finished
        log.info("[%s] Stopped.", self.address)


# ================================================================
# BLE Connection Manager (Replaces Bridge)
# ================================================================
class BLEConnectionManager:
    def __init__(self):
        # Holds active, connected peripherals
        self.peripherals: Dict[str, BLEPeripheral] = {}
        # Holds the *results* of the last scan (device objects)
        self._last_scan_devices: Dict[str, BLEDevice] = {}
        # Holds the MQTT client (injected by lifespan)
        self.mqtt_client: Optional[aiomqtt.Client] = None
        # A lock to prevent simultaneous scans
        self._scan_lock = asyncio.Lock()

    async def scan_for_devices(self) -> List[dict]:
        """
        Scans for BLE devices, filters them, and returns a list for the API.
        This is now the *only* function that scans.
        """
        # <-- CHANGED: Added a lock to prevent scanner conflicts
        async with self._scan_lock:
            log.info("Scanning for devices (name prefix=%r or service=%s) ...", TARGET_NAME_PREFIX, CUSTOM_SERVICE_UUID)
            seen: Dict[str, dict] = {}

            def detection_cb(device, advertisement_data):
                addr = device.address
                uuids = [u.lower() for u in (advertisement_data.service_uuids or [])]
                name = advertisement_data.local_name or device.name
                seen[addr] = {"device": device, "name": name or "", "uuids": uuids}

            scanner = BleakScanner(detection_cb)
            try:
                await scanner.start()
                await asyncio.sleep(SCAN_DURATION)
                await scanner.stop()
            except (BleakError, OSError, FileNotFoundError) as e:
                error_msg = str(e)
                if "No such file or directory" in error_msg or "No adapter" in error_msg.lower():
                    log.error("Bluetooth adapter not available.")
                else:
                    log.error("BLE scan error: %s", e)
                raise # Re-raise the exception to be caught by the API endpoint

            # <-- CHANGED: Store device objects for connecting, return dicts for API
            self._last_scan_devices.clear()
            matches_dict = []
            
            for addr, info in seen.items():
                name = info["name"]
                uuids = info["uuids"]
                name_matches = name and name.upper().startswith(TARGET_NAME_PREFIX.upper())
                uuid_matches = CUSTOM_SERVICE_UUID in uuids

                if name_matches or uuid_matches:
                    log.info("Found candidate: %s (%s) uuids=%s", name or "(no name)", addr, uuids)
                    
                    # Store the device object for later connection
                    self._last_scan_devices[addr] = info["device"]
                    
                    # Store the dict for the API response
                    matches_dict.append({
                        "address": addr,
                        "name": name or "unknown"
                    })
            
            return matches_dict

    # <-- CHANGED: New method to connect to a specific device
    async def connect_to_device(self, address: str) -> BLEPeripheral:
        """Finds a device from the last scan and starts a connection."""
        if address in self.peripherals:
            log.warning("[%s] Connection request ignored, already connected.", address)
            return self.peripherals[address]

        if not self.mqtt_client:
            log.error("[%s] Cannot connect, MQTT client is not available.", address)
            raise RuntimeError("MQTT client is not connected.")

        device = self._last_scan_devices.get(address)
        if not device:
            log.error("[%s] Cannot connect, device not found in last scan.", address)
            raise LookupError(f"Device {address} not found. Run /scan first.")

        log.info("[%s] API requested connection...", address)
        conn = BLEPeripheral(device, device.name, self.mqtt_client)
        self.peripherals[address] = conn
        conn.start() # Starts the connect_and_listen loop in the background
        return conn

    # <-- CHANGED: New method to disconnect a specific device
    async def disconnect_from_device(self, address: str):
        """Stops and removes a connection to a specific device."""
        conn = self.peripherals.pop(address, None)
        if not conn:
            log.warning("[%s] Disconnect request ignored, not connected.", address)
            raise LookupError(f"Device {address} is not connected.")

        log.info("[%s] API requested disconnect...", address)
        await conn.stop()
        log.info("[%s] Disconnect complete.", address)

    # <-- CHANGED: New method to stop all connections on shutdown
    async def stop_all_peripherals(self):
        """Stops all active peripheral connections."""
        log.info("Stopping all peripheral connections...")
        # Create a copy of keys to avoid modification during iteration
        all_addresses = list(self.peripherals.keys())
        tasks = [self.disconnect_from_device(addr) for addr in all_addresses]
        await asyncio.gather(*tasks, return_exceptions=True)


# ================================================================
# FastAPI HTTP Server
# ================================================================

# <-- CHANGED: Global manager instance
_global_manager: Optional[BLEConnectionManager] = None

# <-- CHANGED: New lifespan function to manage MQTT and Manager
@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifespan context manager:
    1. Creates the Connection Manager.
    2. Connects to MQTT.
    3. Injects MQTT client into the manager.
    4. Yields control to the running app.
    5. Cleans up connections on shutdown.
    """
    global _global_manager
    log.info("Starting BLE Gateway API (platform=%s)", sys.platform)
    
    # 1. Create the manager
    _global_manager = BLEConnectionManager()
    
    # 2. Configure and connect MQTT client
    mqtt_kwargs = {"hostname": MQTT_BROKER, "port": MQTT_PORT}
    if MQTT_USERNAME: mqtt_kwargs["username"] = MQTT_USERNAME
    if MQTT_PASSWORD: mqtt_kwargs["password"] = MQTT_PASSWORD
    
    mqtt_client = aiomqtt.Client(**mqtt_kwargs)
    _global_manager.mqtt_client = mqtt_client # 3. Inject client
    
    try:
        await mqtt_client.connect()
        log.info("Connected to MQTT broker at %s", MQTT_BROKER)
    except aiomqtt.MqttError as e:
        log.error("Failed to connect to MQTT: %s. API will run, but publishing will fail.", e)
        # We can still run to allow /scan to work
    
    try:
        yield # 4. Run the app
    finally:
        # 5. Cleanup
        log.info("Shutting down... disconnecting all peripherals.")
        await _global_manager.stop_all_peripherals()
        if mqtt_client.is_connected:
            await mqtt_client.disconnect()
        log.info("Shutdown complete.")


app = FastAPI(title="BLE Gateway API", lifespan=lifespan) # <-- CHANGED

# <-- CHANGED: /scan endpoint now triggers a live scan
@app.get("/scan")
async def scan_devices():
    """
    Triggers a new BLE scan for devices matching the filter.
    Returns a list of devices with address and name.
    """
    if _global_manager is None:
        raise HTTPException(status_code=503, detail="BLE manager not initialized")
    
    try:
        # Use asyncio.wait_for to enforce timeout, as scan_lock
        # might make this call wait
        log.info("API: Received /scan request.")
        results = await asyncio.wait_for(
            _global_manager.scan_for_devices(),
            timeout=SCAN_DURATION + 2.0 # Allow for scan duration + buffer
        )
        return JSONResponse(content=results)
    
    except asyncio.TimeoutError:
        log.warning("BLE scan timed out")
        raise HTTPException(status_code=504, detail="Scan operation timed out")
    except BleakError as e:
        log.error("BLE scan error: %s", e)
        raise HTTPException(status_code=500, detail=f"BLE scan failed: {str(e)}")
    except Exception as e:
        log.exception("Unexpected error during BLE scan: %s", e)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

# <-- CHANGED: New endpoint to connect to a device
@app.post("/connect/{address}")
async def connect_device(address: str):
    """
    Connects to a specific BLE device by its address.
    The device must have been found in a previous /scan.
    """
    if _global_manager is None:
        raise HTTPException(status_code=503, detail="BLE manager not initialized")
    
    try:
        await _global_manager.connect_to_device(address)
        return JSONResponse(content={"status": "connecting", "address": address})
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except (RuntimeError, BleakError) as e:
        raise HTTPException(status_code=500, detail=str(e))

# <-- CHANGED: New endpoint to disconnect
@app.post("/disconnect/{address}")
async def disconnect_device(address: str):
    """Disconnects from a specific BLE device by its address."""
    if _global_manager is None:
        raise HTTPException(status_code=503, detail="BLE manager not initialized")
    
    try:
        await _global_manager.disconnect_from_device(address)
        return JSONResponse(content={"status": "disconnected", "address": address})
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e)) # Not connected

# <-- CHANGED: New endpoint to see active connections
@app.get("/connections")
async def get_active_connections():
    """Returns a list of addresses for all actively connected devices."""
    if _global_manager is None:
        raise HTTPException(status_code=503, detail="BLE manager not initialized")
        
    active_devices = _global_manager.peripherals
    return JSONResponse(content=[
        {
            "address": addr,
            "name": p.name
        }
        for addr, p in active_devices.items()
    ])

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return JSONResponse(content={
        "status": "ok",
        "manager_initialized": _global_manager is not None,
        "mqtt_connected": _global_manager and _global_manager.mqtt_client and _global_manager.mqtt_client.is_connected
    })


# ================================================================
# Main
# ================================================================
async def main():
    """Main entry point - runs FastAPI server."""
    port = int(os.getenv("BLE_API_PORT", "8080"))
    host = os.getenv("BLE_API_HOST", "0.0.0.0")
    
    log.info("Starting BLE Gateway HTTP API on %s:%d", host, port)
    config = uvicorn.Config(app, host=host, port=port, log_level="info")
    server = uvicorn.Server(config)
    await server.serve()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log.info("Exited via KeyboardInterrupt")
    except Exception as e:
        log.exception("Fatal error running main: %s", e)



Also there should be a new table in the postgre that saves data to the current connected esps through ble and when a new one connects or gets removed that change is reflected in the postgre