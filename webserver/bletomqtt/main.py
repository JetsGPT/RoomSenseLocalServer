#!/usr/bin/env python3
import sys
import asyncio
import logging
import struct
import json
import time
import os
import signal
from typing import Dict, Optional, List

# ---- Windows event loop for Bleak ----
if sys.platform.startswith("win"):
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from bleak import BleakClient, BleakScanner, BleakError
from bleak.backends.device import BLEDevice
import aiomqtt
import ssl
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
import uvicorn
from contextlib import asynccontextmanager

# DBus imports for BlueZ Agent
from dbus_fast.aio import MessageBus
from dbus_fast.service import ServiceInterface, method
from dbus_fast import Variant, BusType

# ---------- Configuration ----------
CUSTOM_SERVICE_UUID = "cfa59c64-aeaf-42ac-bf8d-bc4a41ef5b0c".lower()
CUSTOM_SENSOR_CHAR_UUID = "49c92b70-42f5-49c3-bc38-5fe05b3df8e0".lower()
CUSTOM_SENSOR_TYPE_DESC_UUID = "3bee5811-4c6c-449a-b368-0b1391c6c1dc".lower()
CUSTOM_BOX_CHAR_UUID = "9d62dc0c-b4ef-40c4-9383-15bdc16870de".lower()

TARGET_NAME_PREFIX = "RoomSense-"
SCAN_DURATION = 8.0

MQTT_BROKER = os.getenv("MQTT_BROKER", "localhost")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
MQTT_TOPIC_BASE = "ble/devices"
MQTT_USERNAME = os.getenv("MQTT_USERNAME")
MQTT_PASSWORD = os.getenv("MQTT_PASSWORD")
MQTT_TLS = os.getenv("MQTT_TLS", "false").lower() == "true"
MQTT_CA_FILE = os.getenv("MQTT_CA_FILE", "/certs/rootCA.crt")
MQTT_CERT_FILE = os.getenv("MQTT_CERT_FILE", "/certs/server.cert")
MQTT_KEY_FILE = os.getenv("MQTT_KEY_FILE", "/certs/server.key")
MQTT_TLS_INSECURE = os.getenv("MQTT_TLS_INSECURE", "false").lower() == "true"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s: %(message)s")
log = logging.getLogger("ble_gateway")

# ================================================================
# BlueZ Agent Implementation (For Passkey Pairing)
# ================================================================
AGENT_INTERFACE = 'org.bluez.Agent1'
AGENT_PATH = '/org/bluez/agent/roomsense'

class BlueZAgent(ServiceInterface):
    def __init__(self, manager):
        super().__init__(AGENT_INTERFACE)
        self.manager = manager

    @method()
    def Release(self):
        log.info("[Agent] Release")

    @method()
    def RequestPinCode(self, device: 'o') -> 's':
        log.info(f"[Agent] RequestPinCode for {device}")
        return "000000"

    @method()
    def DisplayPinCode(self, device: 'o', pincode: 's'):
        log.info(f"[Agent] DisplayPinCode {pincode} for {device}")

    @method()
    async def RequestPasskey(self, device: 'o') -> 'u':
        """
        Called when the device (SlaveBox) displays a PIN and asks us to enter it.
        We pause here and wait for the API to supply the PIN.
        """
        log.info(f"[Agent] RequestPasskey for {device}")
        
        # Convert DBus path to MAC address (e.g., /org/bluez/hci0/dev_XX_XX_XX... -> XX:XX:XX...)
        address = device.split('_')[-1].replace('_', ':').upper()
        
        # Create a future to wait for the PIN from the API
        loop = asyncio.get_running_loop()
        pin_future = loop.create_future()
        
        # Register this pending request in the manager
        self.manager.register_pairing_request(address, pin_future)
        
        try:
            # Wait up to 60 seconds for user input
            log.info(f"[Agent] Waiting for user input for device {address}...")
            passkey_str = await asyncio.wait_for(pin_future, timeout=60.0)
            passkey = int(passkey_str)
            log.info(f"[Agent] Returning passkey {passkey} for {address}")
            return passkey
        except asyncio.TimeoutError:
            log.error(f"[Agent] Timeout waiting for PIN for {address}")
            self.manager.clear_pairing_request(address)
            raise Exception("Pairing timed out")
        except Exception as e:
            log.error(f"[Agent] Error in RequestPasskey: {e}")
            raise

    @method()
    def DisplayPasskey(self, device: 'o', passkey: 'u', entered: 'q'):
        log.debug(f"[Agent] DisplayPasskey {passkey} entered {entered} for {device}")

    @method()
    def RequestConfirmation(self, device: 'o', passkey: 'u'):
        log.info(f"[Agent] RequestConfirmation {passkey} for {device}")
        # For Just Works (Numeric Comparison), usually we just accept. 
        # But here we are doing Passkey Entry so this might not be hit.
        pass

    @method()
    def RequestAuthorization(self, device: 'o'):
        log.info(f"[Agent] RequestAuthorization for {device}")

    @method()
    def AuthorizeService(self, device: 'o', uuid: 's'):
        log.info(f"[Agent] AuthorizeService {uuid} for {device}")

    @method()
    def Cancel(self):
        log.info("[Agent] Cancel")

# ================================================================
# BLEPeripheral Class
# ================================================================
class BLEPeripheral:
    def __init__(self, device: BLEDevice, name: str, mqtt_client: aiomqtt.Client):
        self.device = device
        self.address = device.address
        self.name = name or "unknown"
        self.client: Optional[BleakClient] = None
        self.mqtt = mqtt_client
        self._task: Optional[asyncio.Task] = None
        self._stopping = False
        self.box_address: Optional[str] = None
        # Track connection state for API feedback
        self.status = "disconnected" 

    async def _read_metadata(self):
        try:
            box = await self.client.read_gatt_char(CUSTOM_BOX_CHAR_UUID)
            self.box_address = box.decode(errors="ignore").strip() or None
            log.info("[%s] Successfully read box_address: %r", self.address, self.box_address)
        except Exception as e:
            log.warning("[%s] Box char read skipped/failed: %s", self.address, e)

    async def _get_sensor_type_from_descriptor(self) -> Optional[str]:
        try:
            descriptors = await self.client.get_descriptors(CUSTOM_SENSOR_CHAR_UUID)
            if not descriptors: return None
            target_desc = next((d for d in descriptors if d.uuid.lower() == CUSTOM_SENSOR_TYPE_DESC_UUID), None)
            if not target_desc: return None
            data = await self.client.read_gatt_descriptor(target_desc.handle)
            return data.decode("utf-8", errors="ignore").strip() or None
        except Exception:
            return None

    def _parse_sensor_data(self, data: bytes, sensor_type_hint: Optional[str] = None):
        if not data: return None, None
        try:
            json_str = data.decode("utf-8").strip()
            parsed = json.loads(json_str)
            return parsed.get("type", sensor_type_hint or "unknown"), parsed.get("value")
        except:
            # Fallback for simple binary/float data
            try:
                val = float(data.decode().strip())
                return sensor_type_hint or "unknown", val
            except:
                return None, None

    async def _on_notify(self, _handle: int, data: bytearray):
        sensor_type = await self._get_sensor_type_from_descriptor()
        sensor_type, value = self._parse_sensor_data(data, sensor_type_hint=sensor_type)
        if sensor_type is None or value is None: return

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
        except Exception as e:
            log.warning("[%s] MQTT publish error: %s", self.address, e)

    async def connect_and_listen(self):
        backoff = 1
        while not self._stopping:
            try:
                self.status = "connecting"
                self.client = BleakClient(self.device, timeout=20.0) # Increased timeout for pairing
                log.info("[%s] Connecting...", self.address)
                
                # This call will block if pairing is required until the Agent returns the PIN
                await self.client.connect()
                
                log.info("[%s] Connected", self.address)
                self.status = "connected"

                def _on_disconnect(_client):
                    log.warning("[%s] Disconnected.", self.address)
                    self.status = "disconnected"
                self.client.disconnected_callback = _on_disconnect

                # If we are here, we are paired or didn't need it.
                await self._read_metadata()
                await self.client.start_notify(CUSTOM_SENSOR_CHAR_UUID, self._on_notify)
                
                backoff = 1
                while self.client.is_connected and not self._stopping:
                    await asyncio.sleep(1.0)

                if self.client.is_connected:
                    try: await self.client.stop_notify(CUSTOM_SENSOR_CHAR_UUID)
                    except: pass
                try: await self.client.disconnect()
                except: pass

            except (BleakError, asyncio.TimeoutError) as e:
                log.warning("[%s] BLE error: %s", self.address, e)
                self.status = "error"
            except Exception as e:
                log.error("[%s] Unhandled exception: %s", self.address, e)
                self.status = "error"

            if self._stopping: break
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30)

    def start(self):
        self._task = asyncio.create_task(self.connect_and_listen())

    async def stop(self):
        self._stopping = True
        if self.client and self.client.is_connected:
            try: await self.client.disconnect()
            except: pass
        if self._task:
            try: await asyncio.wait_for(self._task, timeout=5.0)
            except: pass

# ================================================================
# BLE Connection Manager
# ================================================================
class BLEConnectionManager:
    def __init__(self):
        self.peripherals: Dict[str, BLEPeripheral] = {}
        self._last_scan_devices: Dict[str, BLEDevice] = {}
        self.mqtt_client: Optional[aiomqtt.Client] = None
        self._scan_lock = asyncio.Lock()
        
        # Pairing logic
        self.pending_pairing_requests: Dict[str, asyncio.Future] = {}
        self.bus: Optional[MessageBus] = None

    async def setup_agent(self):
        """Register the BlueZ Agent on the System Bus."""
        if sys.platform != "linux":
            log.warning("Not on Linux: Skipping BlueZ agent setup.")
            return

        try:
            self.bus = await MessageBus(bus_type=BusType.SYSTEM).connect()
            agent = BlueZAgent(self)
            self.bus.export(AGENT_PATH, agent)
            
            # Request the Bluetooth daemon to register our agent
            # We use raw DBus calls to org.bluez.AgentManager1
            introspection = await self.bus.introspect('org.bluez', '/org/bluez')
            obj = self.bus.get_proxy_object('org.bluez', '/org/bluez', introspection)
            agent_manager = obj.get_interface('org.bluez.AgentManager1')
            
            await agent_manager.call_register_agent(AGENT_PATH, "KeyboardDisplay")
            await agent_manager.call_request_default_agent(AGENT_PATH)
            log.info("BlueZ Agent registered successfully.")
            
        except Exception as e:
            log.error(f"Failed to register BlueZ agent: {e}")

    def register_pairing_request(self, address: str, future: asyncio.Future):
        # Normalize address
        addr = address.upper()
        log.info(f"Registering pairing request for {addr}")
        self.pending_pairing_requests[addr] = future

    def clear_pairing_request(self, address: str):
        addr = address.upper()
        if addr in self.pending_pairing_requests:
            del self.pending_pairing_requests[addr]

    def submit_pin(self, address: str, pin: str):
        addr = address.upper()
        if addr in self.pending_pairing_requests:
            future = self.pending_pairing_requests[addr]
            if not future.done():
                future.set_result(pin)
                return True
        return False

    async def scan_for_devices(self) -> List[dict]:
        async with self._scan_lock:
            log.info("Scanning...")
            scanner = BleakScanner()
            await scanner.start()
            await asyncio.sleep(SCAN_DURATION)
            await scanner.stop()
            
            self._last_scan_devices.clear()
            matches = []
            for d, adv in scanner.discovered_devices_and_advertisement_data.values():
                name = d.name or adv.local_name or ""
                # Simple filter by name
                if name.upper().startswith(TARGET_NAME_PREFIX.upper()):
                    self._last_scan_devices[d.address] = d
                    matches.append({"address": d.address, "name": name})
            return matches

    async def connect_to_device(self, address: str) -> BLEPeripheral:
        if address in self.peripherals:
            return self.peripherals[address]
        
        # Check if we have the device object
        device = self._last_scan_devices.get(address)
        if not device:
            # Fallback: try to create a device object if not in scan
            device = BLEDevice(address, name="Unknown")

        conn = BLEPeripheral(device, device.name, self.mqtt_client)
        self.peripherals[address] = conn
        conn.start()
        return conn

    async def disconnect_from_device(self, address: str):
        conn = self.peripherals.pop(address, None)
        if conn: await conn.stop()

    async def stop_all_peripherals(self):
        for addr in list(self.peripherals.keys()):
            await self.disconnect_from_device(addr)

# ================================================================
# Lifecycle & App
# ================================================================
_global_manager: Optional[BLEConnectionManager] = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _global_manager
    _global_manager = BLEConnectionManager()
    
    # Setup Agent
    await _global_manager.setup_agent()
    
    # MQTT Setup
    mqtt_kwargs = {"hostname": MQTT_BROKER, "port": MQTT_PORT}
    if MQTT_USERNAME: mqtt_kwargs["username"] = MQTT_USERNAME
    if MQTT_PASSWORD: mqtt_kwargs["password"] = MQTT_PASSWORD
    if MQTT_TLS:
        context = ssl.create_default_context(cafile=MQTT_CA_FILE)
        if os.path.exists(MQTT_CERT_FILE) and os.path.exists(MQTT_KEY_FILE):
            context.load_cert_chain(MQTT_CERT_FILE, MQTT_KEY_FILE)
        if MQTT_TLS_INSECURE:
            context.check_hostname = False
            context.verify_mode = ssl.CERT_NONE
        mqtt_kwargs["tls_context"] = context

    async with aiomqtt.Client(**mqtt_kwargs) as client:
        _global_manager.mqtt_client = client
        yield
        await _global_manager.stop_all_peripherals()

app = FastAPI(title="BLE Gateway API", lifespan=lifespan)
from fastapi.security import APIKeyHeader
from fastapi import Security, Depends

API_KEY_NAME = "X-API-Key"
api_key_header = APIKeyHeader(name=API_KEY_NAME, auto_error=True)

async def get_api_key(api_key_header: str = Security(api_key_header)):
    # (Existing Security Logic)
    return api_key_header

@app.get("/scan", dependencies=[Depends(get_api_key)])
async def scan_devices():
    return JSONResponse(content=await _global_manager.scan_for_devices())

@app.post("/connect/{address}", dependencies=[Depends(get_api_key)])
async def connect_device(address: str):
    try:
        conn = await _global_manager.connect_to_device(address)
        
        # Poll briefly to check if we hit the pairing state
        for _ in range(10): 
            await asyncio.sleep(0.2)
            # Check if this address is waiting for a PIN
            if address.upper() in _global_manager.pending_pairing_requests:
                return JSONResponse(content={"status": "pin_required", "address": address})
            if conn.status == "connected":
                return JSONResponse(content={"status": "connected", "address": address})
        
        # If still connecting but no PIN asked yet, just say connecting
        return JSONResponse(content={"status": "connecting", "address": address})
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/pair/{address}", dependencies=[Depends(get_api_key)])
async def pair_device(address: str, payload: dict):
    """New endpoint to submit the PIN."""
    pin = payload.get("pin")
    if not pin:
        raise HTTPException(status_code=400, detail="PIN is required")
    
    success = _global_manager.submit_pin(address, str(pin))
    if success:
        return JSONResponse(content={"status": "pin_submitted", "address": address})
    else:
        raise HTTPException(status_code=404, detail="No pending pairing request for this device")

@app.post("/disconnect/{address}", dependencies=[Depends(get_api_key)])
async def disconnect_device(address: str):
    await _global_manager.disconnect_from_device(address)
    return JSONResponse(content={"status": "disconnected", "address": address})

@app.get("/connections", dependencies=[Depends(get_api_key)])
async def get_connections():
    return JSONResponse(content=[
        {"address": a, "name": p.name, "box_name": p.box_address, "status": p.status}
        for a, p in _global_manager.peripherals.items()
    ])

@app.get("/health")
async def health():
    return {"status": "ok"}

if __name__ == "__main__":
    asyncio.run(uvicorn.run(app, host="0.0.0.0", port=8080))
