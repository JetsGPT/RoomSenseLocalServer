#!/usr/bin/env python3
import sys
import asyncio
import logging
import json
import time
import os
import re
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
# Helper: Read Docker Swarm Secrets
# ================================================================
SECRETS_DIR = "/run/secrets"

def read_docker_secret(secret_name: str) -> Optional[str]:
    """Read a secret from Docker Swarm secrets directory."""
    secret_path = os.path.join(SECRETS_DIR, secret_name)
    try:
        if os.path.exists(secret_path):
            with open(secret_path, 'r') as f:
                # Strip whitespace/newlines like the Node.js version does
                return f.read().strip()
    except Exception as e:
        log.warning(f"Could not read secret {secret_name}: {e}")
    return None

def get_config_value(env_var: str, secret_name: str, default: Optional[str] = None, required: bool = False) -> Optional[str]:
    """Get config value from env var first, then Docker secret, then default.
    
    If required=True and no value found, raises an error (matching Node.js loadSecrets.js behavior).
    """
    # Priority: env var > Docker secret > default
    value = os.getenv(env_var)
    if value:
        log.info(f"{env_var} loaded from environment variable")
        return value
    value = read_docker_secret(secret_name)
    if value:
        log.info(f"{env_var} loaded from Docker secret")
        return value
    if default is not None:
        return default
    if required:
        # Match Node.js behavior: throw error if secret not found
        raise RuntimeError(f"CRITICAL: {env_var} not found in secrets (Docker Swarm) and not set in environment. Secret file: {secret_name}")
    return None

# MAC Address validation regex
MAC_ADDRESS_REGEX = re.compile(r'^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$')

def normalize_mac_address(address: str) -> str:
    """Normalize MAC address to uppercase with colons."""
    # Replace dashes with colons and uppercase
    return address.upper().replace('-', ':')

def validate_mac_address(address: str) -> bool:
    """Validate MAC address format."""
    return bool(MAC_ADDRESS_REGEX.match(address))

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
        
        # Convert DBus path to MAC address (e.g., /org/bluez/hci0/dev_2C_BC_... -> 2C:BC:...)
        address = device.split('/')[-1].replace('dev_', '').replace('_', ':').upper()
        
        # Create a future to wait for the PIN from the API
        loop = asyncio.get_running_loop()
        pin_future = loop.create_future()
        
        # Register this pending request in the manager
        self.manager.register_pairing_request(address, pin_future)
        
        try:
            # Wait up to 25 seconds for user input (5s shorter than ESP32's 30s timer for safety margin)
            log.info(f"[Agent] Waiting for user input for device {address}...")
            
            # Signal that we're waiting for PIN (wake up any polling endpoints)
            self.manager.signal_state_change(address)
            
            passkey_str = await asyncio.wait_for(pin_future, timeout=25.0)
            passkey = int(passkey_str)
            log.info(f"[Agent] Returning passkey {passkey} for {address}")
            return passkey
        except asyncio.TimeoutError:
            log.error(f"[Agent] Timeout waiting for PIN for {address}")
            raise Exception("Pairing timed out")
        except asyncio.CancelledError:
            log.warning(f"[Agent] Pairing cancelled for {address}")
            raise Exception("Pairing cancelled")
        except Exception as e:
            log.error(f"[Agent] Error in RequestPasskey: {e}")
            raise
        finally:
            # ALWAYS clean up, even on success (the PIN was already submitted)
            self.manager.clear_pairing_request(address)

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
        log.info("[Agent] Cancel - cleaning up all pending pairing requests")
        # Clean up all pending pairing requests when BlueZ cancels
        for addr in list(self.manager.pending_pairing_requests.keys()):
            future = self.manager.pending_pairing_requests.get(addr)
            if future and not future.done():
                future.cancel()
            self.manager.clear_pairing_request(addr)

# ================================================================
# BLEPeripheral Class
# ================================================================
class BLEPeripheral:
    def __init__(self, device: BLEDevice, name: str, mqtt_client: aiomqtt.Client, manager=None):
        self.device = device
        self.address = device.address
        self.name = name or "unknown"
        self.client: Optional[BleakClient] = None
        self.mqtt = mqtt_client
        self.manager = manager  # Reference to BLEConnectionManager for cleanup
        self._task: Optional[asyncio.Task] = None
        self._stopping = False
        self.box_address: Optional[str] = None
        # Track connection state for API feedback
        self.status = "disconnected"
        # Track if pairing specifically failed - prevents auto-retry which causes rapid connect cycles
        self._pairing_failed = False 

    async def _read_metadata(self):
        # NOTE: We intentionally let exceptions bubble up here.
        # If reading this secured char fails (e.g. Auth failed), we MUST NOT proceed to "connected".
        box = await self.client.read_gatt_char(CUSTOM_BOX_CHAR_UUID)
        self.box_address = box.decode(errors="ignore").strip() or None
        log.info("[%s] Successfully read box_address: %r", self.address, self.box_address)

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
        except Exception:
            # Fallback for simple binary/float data
            try:
                val = float(data.decode().strip())
                return sensor_type_hint or "unknown", val
            except Exception:
                return None, None

    async def _on_notify(self, _handle: int, data: bytearray):
        # 1. Try to parse from JSON first (FAST - ESP32 sends type in JSON)
        sensor_type, value = self._parse_sensor_data(data)
        
        # 2. Only perform the slow network call if JSON didn't include the type
        if sensor_type == "unknown" or sensor_type is None:
            sensor_type_hint = await self._get_sensor_type_from_descriptor()  # SLOW
            sensor_type, value = self._parse_sensor_data(data, sensor_type_hint=sensor_type_hint)

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
                # Don't set "connected" yet. We are technically connected but arguably 
                # still performing the security handshake (triggered by read_metadata or pair).
                self.status = "authenticating"

                def _on_disconnect(_client):
                    log.warning("[%s] Disconnected.", self.address)
                    self.status = "disconnected"
                    if self.manager:
                        self.manager.signal_state_change(self.address)
                self.client.disconnected_callback = _on_disconnect

                # Explicitly pair BEFORE trying to read encrypted characteristics.
                # This is critical: pair() will block until the Agent's RequestPasskey()
                # returns with the user-provided PIN. Without this, read_gatt_char() 
                # times out after ~5 seconds before the user can enter the PIN.
                try:
                    log.info("[%s] Starting pairing (waiting for PIN entry)...", self.address)
                    # Use a long timeout to give user time to enter PIN
                    # The Agent has a 25-second timeout, so 60 seconds here is plenty
                    await asyncio.wait_for(self.client.pair(), timeout=60.0)
                    log.info("[%s] Pairing successful!", self.address)
                except asyncio.TimeoutError:
                    log.error("[%s] Pairing timed out (no PIN entered within 60 seconds)", self.address)
                    self._pairing_failed = True
                    self.status = "pairing_failed"
                    if self.manager:
                        self.manager.clear_pairing_request(self.address)
                        self.manager.signal_state_change(self.address)
                    try:
                        await self.client.disconnect()
                    except Exception:
                        pass
                    break
                except Exception as e:
                    log.error("[%s] Pairing failed: %s", self.address, e)
                    self._pairing_failed = True
                    self.status = "pairing_failed"
                    try:
                        await self.client.unpair()
                    except Exception:
                        pass
                    try:
                        await self.client.disconnect()
                    except Exception:
                        pass
                    if self.manager:
                        self.manager.clear_pairing_request(self.address)
                        self.manager.signal_state_change(self.address)
                    break

                # Now that we're paired, read the metadata
                try:
                    await self._read_metadata()
                except Exception as e:
                    log.error("[%s] Metadata read failed after pairing: %s", self.address, e)
                    self._pairing_failed = True
                    self.status = "pairing_failed"
                    try:
                        await self.client.unpair()
                    except Exception:
                        pass
                    try:
                        await self.client.disconnect()
                    except Exception:
                        pass
                    if self.manager:
                        self.manager.clear_pairing_request(self.address)
                        self.manager.signal_state_change(self.address)
                    # Don't raise - break out of the loop instead
                    break
                
                # NOW we are truly ready and authenticated
                self.status = "connected"
                if self.manager:
                    self.manager.signal_state_change(self.address)
                
                # Start notifications - handle failure
                try:
                    await self.client.start_notify(CUSTOM_SENSOR_CHAR_UUID, self._on_notify)
                except Exception as e:
                    log.error("[%s] Failed to start notifications: %s", self.address, e)
                    self.status = "error"
                    if self.manager:
                        self.manager.signal_state_change(self.address)
                    raise
                
                backoff = 1
                while self.client.is_connected and not self._stopping:
                    await asyncio.sleep(1.0)

                if self.client.is_connected:
                    try: await self.client.stop_notify(CUSTOM_SENSOR_CHAR_UUID)
                    except Exception: pass
                try: await self.client.disconnect()
                except Exception: pass

            except (BleakError, asyncio.TimeoutError) as e:
                log.warning("[%s] BLE error: %s", self.address, e)
                # Check if this is likely a pairing-related error
                error_str = str(e).lower()
                if "auth" in error_str or "pair" in error_str or "encrypt" in error_str or "security" in error_str:
                    log.warning("[%s] Detected pairing-related error, marking as pairing failure", self.address)
                    self._pairing_failed = True
                    self.status = "pairing_failed"
                else:
                    self.status = "error"
                # Clean up any pending pairing request on failure
                if self.manager:
                    self.manager.clear_pairing_request(self.address)
                    self.manager.signal_state_change(self.address)
            except Exception as e:
                log.error("[%s] Unhandled exception: %s", self.address, e)
                self.status = "error"
                # Clean up any pending pairing request on failure
                if self.manager:
                    self.manager.clear_pairing_request(self.address)
                    self.manager.signal_state_change(self.address)

            # Don't retry if pairing failed or we're stopping
            if self._stopping or self._pairing_failed:
                break
            
            # Minimum 5 second delay before retry to let ESP32 state settle
            await asyncio.sleep(max(backoff, 5))
            backoff = min(backoff * 2, 30)

    def start(self):
        self._task = asyncio.create_task(self.connect_and_listen())

    async def stop(self):
        self._stopping = True
        if self.client and self.client.is_connected:
            try: await self.client.disconnect()
            except Exception: pass
        if self._task:
            try: await asyncio.wait_for(self._task, timeout=5.0)
            except Exception: pass

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
        
        # Event-based signaling for immediate state change notification
        self._state_change_events: Dict[str, asyncio.Event] = {}

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
            
            await agent_manager.call_register_agent(AGENT_PATH, "KeyboardOnly")
            
            # Try to become the default agent, but handle failure gracefully
            try:
                await agent_manager.call_request_default_agent(AGENT_PATH)
                log.info("BlueZ Agent registered as default successfully.")
            except Exception as default_err:
                log.warning(f"Could not become default agent (another BT manager may be running): {default_err}")
                log.warning("Pairing requests may be routed to the system's Bluetooth manager instead of this API.")
            
        except Exception as e:
            log.error(f"Failed to register BlueZ agent: {e}")

    def register_pairing_request(self, address: str, future: asyncio.Future):
        # Normalize address
        addr = address.upper()
        log.info(f"Registering pairing request for {addr}")
        self.pending_pairing_requests[addr] = future
        # Signal state change for any waiting endpoints
        self.signal_state_change(addr)

    def clear_pairing_request(self, address: str):
        addr = address.upper()
        if addr in self.pending_pairing_requests:
            del self.pending_pairing_requests[addr]
        # Signal state change for any waiting endpoints
        self.signal_state_change(addr)

    def submit_pin(self, address: str, pin: str):
        addr = address.upper()
        if addr in self.pending_pairing_requests:
            future = self.pending_pairing_requests[addr]
            if not future.done():
                future.set_result(pin)
                # Signal state change
                self.signal_state_change(addr)
                return True
        return False
    
    def get_state_event(self, address: str) -> asyncio.Event:
        """Get or create an event for state change signaling."""
        addr = address.upper()
        if addr not in self._state_change_events:
            self._state_change_events[addr] = asyncio.Event()
        return self._state_change_events[addr]
    
    def signal_state_change(self, address: str):
        """Signal that the state for a device has changed."""
        addr = address.upper()
        if addr in self._state_change_events:
            self._state_change_events[addr].set()
    
    def clear_state_event(self, address: str):
        """Clear and reset the state event for next wait cycle."""
        addr = address.upper()
        if addr in self._state_change_events:
            self._state_change_events[addr].clear()

    async def scan_for_devices(self) -> List[dict]:
        async with self._scan_lock:
            log.info("Scanning...")
            scanner = BleakScanner(scanning_mode="active")
            await scanner.start()
            await asyncio.sleep(SCAN_DURATION)  # 8 seconds scan duration
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

    async def remove_bluez_device(self, address: str):
        """Remove a device from BlueZ completely (clears bond/pairing info).
        
        This is important to call before fresh pairing attempts to avoid
        stale keys causing authentication failures.
        """
        if sys.platform != "linux" or not self.bus:
            return
        
        try:
            # Convert MAC address to BlueZ device path format
            # e.g., 2C:BC:BB:4C:2E:26 -> /org/bluez/hci0/dev_2C_BC_BB_4C_2E_26
            addr_path = address.upper().replace(":", "_")
            device_path = f"/org/bluez/hci0/dev_{addr_path}"
            
            introspection = await self.bus.introspect('org.bluez', '/org/bluez/hci0')
            adapter_obj = self.bus.get_proxy_object('org.bluez', '/org/bluez/hci0', introspection)
            adapter = adapter_obj.get_interface('org.bluez.Adapter1')
            
            await adapter.call_remove_device(device_path)
            log.info(f"[{address}] Removed device from BlueZ to clear stale pairing")
        except Exception as e:
            # Device might not exist or already be unpaired - that's fine
            log.debug(f"[{address}] Could not remove BlueZ device (may not exist): {e}")

    async def connect_to_device(self, address: str) -> BLEPeripheral:
        if address in self.peripherals:
            existing = self.peripherals[address]
            # If already connected, return as-is
            if existing.status == "connected":
                return existing
            # Otherwise, stop and remove the stale peripheral to start fresh
            log.info("[%s] Removing stale peripheral (status=%s) before reconnection", address, existing.status)
            await existing.stop()
            del self.peripherals[address]
        
        # Check if we have the device object from a recent scan
        device = self._last_scan_devices.get(address)
        if not device:
            # Device not in cache - trigger a quick scan to find it
            log.info(f"[{address}] Not in scan cache, performing quick scan...")
            await self.scan_for_devices()
            device = self._last_scan_devices.get(address)
            if not device:
                raise ValueError(f"Device {address} not found after scan. Ensure the device is powered on and in range.")

        # Clear any stale pairing state before starting a fresh connection
        self.clear_pairing_request(address)
        
        # Remove any stale BlueZ bonds that might cause auth issues
        await self.remove_bluez_device(address)
        
        # Small delay after removing device to let BlueZ settle
        await asyncio.sleep(0.5)
        
        # Re-scan to get a fresh device handle after removal
        await self.scan_for_devices()
        device = self._last_scan_devices.get(address)
        if not device:
            raise ValueError(f"Device {address} not found after rescan. Ensure the device is powered on and in range.")
        
        # Prepare state event for this connection
        self.get_state_event(address)  # Ensure event exists
        self.clear_state_event(address)  # Reset it

        conn = BLEPeripheral(device, device.name, self.mqtt_client, manager=self)
        self.peripherals[address] = conn
        conn.start()
        return conn

    async def disconnect_from_device(self, address: str):
        addr = normalize_mac_address(address)
        conn = self.peripherals.pop(addr, None)
        if conn: 
            await conn.stop()
        # Clean up state events to prevent memory leak
        if addr in self._state_change_events:
            del self._state_change_events[addr]

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

# API Key from Docker secret or environment variable (REQUIRED)
API_KEY = get_config_value("BLE_GATEWAY_API_KEY", "ble_gateway_api_key", required=True)
API_KEY_NAME = "X-API-Key"
api_key_header = APIKeyHeader(name=API_KEY_NAME, auto_error=True)

async def get_api_key(api_key_header: str = Security(api_key_header)):
    """Validate API key against configured value."""
    if api_key_header != API_KEY:
        raise HTTPException(status_code=403, detail="Invalid API key")
    return api_key_header

@app.get("/scan", dependencies=[Depends(get_api_key)])
async def scan_devices():
    return JSONResponse(content=await _global_manager.scan_for_devices())

@app.post("/connect/{address}", dependencies=[Depends(get_api_key)])
async def connect_device(address: str):
    # Validate and normalize MAC address
    if not validate_mac_address(address):
        raise HTTPException(status_code=400, detail=f"Invalid MAC address format: {address}")
    addr = normalize_mac_address(address)
    
    try:
        conn = await _global_manager.connect_to_device(addr)
        state_event = _global_manager.get_state_event(addr)
        
        # Poll for up to 30 seconds using event-based waiting for immediate response
        timeout_end = time.time() + 30.0
        while time.time() < timeout_end:
            # Check current status - order matters to avoid race conditions
            current_status = conn.status
            has_pending_request = addr in _global_manager.pending_pairing_requests
            
            # If pairing failed, report immediately
            if current_status == "pairing_failed":
                return JSONResponse(
                    status_code=400,
                    content={"status": "pairing_failed", "address": addr, "detail": "Pairing failed - incorrect PIN or device rejected"}
                )
            
            # If connection failed, report error immediately
            if current_status == "error":
                raise HTTPException(status_code=500, detail="Connection failed during pairing")
            
            # Check if this address is waiting for a PIN
            if has_pending_request:
                return JSONResponse(content={"status": "pin_required", "address": addr})
            
            # Authenticated means PIN was submitted, waiting for result
            if current_status == "authenticating" and not has_pending_request:
                # PIN was submitted, continue polling for final result
                pass
            elif current_status == "connected":
                return JSONResponse(content={"status": "connected", "address": addr})
            
            # Wait for state change event or timeout after 500ms
            try:
                await asyncio.wait_for(state_event.wait(), timeout=0.5)
            except asyncio.TimeoutError:
                pass  # Continue polling
            finally:
                _global_manager.clear_state_event(addr)  # Clear AFTER wait to avoid race
        
        # If still connecting but no PIN asked yet, timeout with status
        return JSONResponse(content={"status": "timeout", "address": addr, "last_status": conn.status})
        
    except HTTPException:
        raise  # Re-raise HTTPException as-is
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/pair/{address}", dependencies=[Depends(get_api_key)])
async def pair_device(address: str, payload: dict):
    """Submit the PIN and poll for pairing result."""
    # Validate and normalize MAC address
    if not validate_mac_address(address):
        raise HTTPException(status_code=400, detail=f"Invalid MAC address format: {address}")
    addr = normalize_mac_address(address)
    
    pin = payload.get("pin")
    if pin is None:
        raise HTTPException(status_code=400, detail="PIN is required")
    
    success = _global_manager.submit_pin(addr, str(pin))
    if not success:
        raise HTTPException(status_code=404, detail="No pending pairing request for this device")
    
    # Poll for up to 10 seconds for the pairing result using event-based waiting
    conn = _global_manager.peripherals.get(addr)
    if not conn:
        raise HTTPException(status_code=404, detail="Device connection not found")
    
    state_event = _global_manager.get_state_event(addr)
    timeout_end = time.time() + 10.0
    
    while time.time() < timeout_end:
        if conn.status == "connected":
            return JSONResponse(content={"status": "paired", "address": addr})
        elif conn.status == "pairing_failed":
            return JSONResponse(
                status_code=400,
                content={"status": "pairing_failed", "address": addr, "detail": "Incorrect PIN or pairing rejected"}
            )
        elif conn.status == "error":
            return JSONResponse(
                status_code=400,
                content={"status": "pairing_failed", "address": addr, "detail": "Connection error during pairing"}
            )
        elif conn.status == "disconnected":
            return JSONResponse(
                status_code=400,
                content={"status": "pairing_failed", "address": addr, "detail": "Device disconnected during pairing"}
            )
        
        # Wait for state change event or timeout after 500ms
        try:
            await asyncio.wait_for(state_event.wait(), timeout=0.5)
        except asyncio.TimeoutError:
            pass  # Continue polling
        finally:
            _global_manager.clear_state_event(addr)  # Clear AFTER wait to avoid race
    
    # Timeout - pairing result unknown
    return JSONResponse(content={"status": "pairing_timeout", "address": addr, "last_status": conn.status})

@app.post("/disconnect/{address}", dependencies=[Depends(get_api_key)])
async def disconnect_device(address: str):
    if not validate_mac_address(address):
        raise HTTPException(status_code=400, detail=f"Invalid MAC address format: {address}")
    addr = normalize_mac_address(address)
    await _global_manager.disconnect_from_device(addr)
    return JSONResponse(content={"status": "disconnected", "address": addr})

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
    uvicorn.run(app, host="0.0.0.0", port=8080)
