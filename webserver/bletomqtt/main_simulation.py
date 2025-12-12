
#!/usr/bin/env python3
"""
BLE Device Simulator
Simulates RoomSense boxes exactly like main.py but without BLE hardware.
Provides the same FastAPI endpoints and sends mock sensor data to MQTT broker.

Usage:
    python main_simulator.py
    python main_simulator.py --boxes 5 --interval 5
"""

import sys
import asyncio

# ---- Windows event loop policy ----
if sys.platform.startswith("win"):
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

import json
import logging
import random
import time
import os
import argparse
from typing import Dict, List, Optional
from contextlib import asynccontextmanager

import aiomqtt
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
import uvicorn

# Configuration
MQTT_BROKER = os.getenv("MQTT_BROKER", "localhost")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
MQTT_TOPIC_BASE = "ble/devices"
MQTT_USERNAME = os.getenv("MQTT_USERNAME", None)
MQTT_PASSWORD = os.getenv("MQTT_PASSWORD", None)
MQTT_TLS = os.getenv("MQTT_TLS", "false").lower() == "true"
MQTT_CA_FILE = os.getenv("MQTT_CA_FILE", "/certs/rootCA.crt")
MQTT_CERT_FILE = os.getenv("MQTT_CERT_FILE", "/certs/server.cert")
MQTT_KEY_FILE = os.getenv("MQTT_KEY_FILE", "/certs/server.key")
MQTT_TLS_INSECURE = os.getenv("MQTT_TLS_INSECURE", "false").lower() == "true"

# Simulation defaults
DEFAULT_NUM_BOXES = 3
DEFAULT_INTERVAL_SECONDS = 10
DEFAULT_SENSOR_TYPES = ["temperature", "humidity", "pressure", "light"]

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
log = logging.getLogger("ble_simulator")


class SimulatedPeripheral:
    """Simulates a BLE peripheral device that sends sensor data."""
    
    def __init__(self, address: str, name: str, box_id: str, mqtt_client: aiomqtt.Client, sensor_types: List[str]):
        self.address = address
        self.name = name
        self.box_id = box_id
        self.mqtt = mqtt_client
        self.sensor_types = sensor_types
        self._task: Optional[asyncio.Task] = None
        self._stopping = False
        self.base_values = {}
        # Add random initial delay to stagger publishing across devices
        self._initial_delay = random.uniform(0, DEFAULT_INTERVAL_SECONDS)
        
        # Initialize realistic base values for each sensor
        for sensor_type in sensor_types:
            if sensor_type == "temperature":
                self.base_values[sensor_type] = random.uniform(18.0, 25.0)
            elif sensor_type == "humidity":
                self.base_values[sensor_type] = random.uniform(40.0, 70.0)
            elif sensor_type == "pressure":
                self.base_values[sensor_type] = random.uniform(980.0, 1020.0)
            elif sensor_type == "light":
                self.base_values[sensor_type] = random.uniform(0.0, 1000.0)
            else:
                self.base_values[sensor_type] = random.uniform(0.0, 100.0)
    
    def generate_sensor_value(self, sensor_type: str) -> float:
        """Generate a realistic sensor value with small random variations."""
        base = self.base_values[sensor_type]
        
        if sensor_type == "temperature":
            variation = random.uniform(-0.3, 0.3)
        elif sensor_type == "humidity":
            variation = random.uniform(-1.0, 1.0)
        elif sensor_type == "pressure":
            variation = random.uniform(-0.5, 0.5)
        elif sensor_type == "light":
            variation = random.uniform(-50.0, 50.0)
        else:
            variation = random.uniform(-0.05, 0.05)
        
        new_value = base + (base * variation)
        
        # Update base value slightly (drift)
        self.base_values[sensor_type] += random.uniform(-0.1, 0.1) * (base / 100)
        
        # Keep values in reasonable ranges
        if sensor_type == "temperature":
            new_value = max(10.0, min(35.0, new_value))
        elif sensor_type == "humidity":
            new_value = max(20.0, min(90.0, new_value))
        elif sensor_type == "pressure":
            new_value = max(950.0, min(1050.0, new_value))
        elif sensor_type == "light":
            new_value = max(0.0, min(2000.0, new_value))
        
        return round(new_value, 2)
    
    async def _send_sensor_data(self):
        """Continuously send sensor data to MQTT."""
        # Stagger initial start to avoid all devices publishing at once
        await asyncio.sleep(self._initial_delay)
        
        while not self._stopping:
            for sensor_type in self.sensor_types:
                value = self.generate_sensor_value(sensor_type)
                payload = {
                    "sensor_box": self.box_id,
                    "sensor_type": sensor_type,
                    "value": value,
                    "ts": int(time.time() * 1000),
                }
                topic = f"{MQTT_TOPIC_BASE}/{self.box_id}"
                try:
                    await self.mqtt.publish(topic, json.dumps(payload).encode("utf-8"), qos=0)
                    log.debug(f"[{self.address}] Published {sensor_type}: {value} to {topic}")
                except Exception as e:
                    log.warning(f"[{self.address}] MQTT publish error: {e}")
            
            # Add small random jitter (±10%) to interval to prevent synchronization
            jitter = random.uniform(-0.1, 0.1) * DEFAULT_INTERVAL_SECONDS
            await asyncio.sleep(DEFAULT_INTERVAL_SECONDS + jitter)
    
    def start(self):
        """Starts the data sending task."""
        self._stopping = False
        self._task = asyncio.create_task(self._send_sensor_data())
        log.info(f"[{self.address}] Started simulated device: {self.name} (box: {self.box_id})")
    
    async def stop(self):
        """Stops the data sending task."""
        log.info(f"[{self.address}] Stopping simulated device...")
        self._stopping = True
        if self._task:
            try:
                await asyncio.wait_for(self._task, timeout=2.0)
            except asyncio.TimeoutError:
                self._task.cancel()
            except Exception:
                pass
        log.info(f"[{self.address}] Stopped.")


class SimulatedConnectionManager:
    """Manages simulated BLE devices (like BLEConnectionManager but without BLE)."""
    
    def __init__(self, num_boxes: int = DEFAULT_NUM_BOXES):
        self.peripherals: Dict[str, SimulatedPeripheral] = {}
        self.mqtt_client: Optional[aiomqtt.Client] = None
        self.num_boxes = num_boxes
        self._available_devices: Dict[str, dict] = {}
        self._initialize_available_devices()
    
    def _initialize_available_devices(self):
        """Initialize a pool of available simulated devices."""
        for i in range(1, self.num_boxes + 1):
            address = f"AA:BB:CC:DD:EE:{i:02X}"
            box_id = f"box_{i:03d}"
            name = f"RoomSense-{box_id}"
            self._available_devices[address] = {
                "address": address,
                "name": name,
                "box_id": box_id
            }
    
    async def scan_for_devices(self) -> List[dict]:
        """Simulates a BLE scan - returns available simulated devices."""
        log.info("Simulated scan: Found %d devices", len(self._available_devices))
        return [
            {"address": addr, "name": info["name"]}
            for addr, info in self._available_devices.items()
        ]
    
    async def connect_to_device(self, address: str) -> SimulatedPeripheral:
        """Simulates connecting to a device - starts sending mock data."""
        if address in self.peripherals:
            log.warning(f"[{address}] Already connected")
            return self.peripherals[address]
        
        if not self.mqtt_client:
            raise RuntimeError("MQTT client is not connected.")
        
        device_info = self._available_devices.get(address)
        if not device_info:
            raise LookupError(f"Device {address} not found. Run /scan first.")
        
        log.info(f"[{address}] Simulating connection...")
        peripheral = SimulatedPeripheral(
            address=address,
            name=device_info["name"],
            box_id=device_info["box_id"],
            mqtt_client=self.mqtt_client,
            sensor_types=DEFAULT_SENSOR_TYPES
        )
        self.peripherals[address] = peripheral
        peripheral.start()
        return peripheral
    
    async def disconnect_from_device(self, address: str):
        """Simulates disconnecting from a device - stops sending data."""
        peripheral = self.peripherals.pop(address, None)
        if not peripheral:
            raise LookupError(f"Device {address} is not connected.")
        
        log.info(f"[{address}] Simulating disconnection...")
        await peripheral.stop()
        log.info(f"[{address}] Disconnected.")
    
    async def stop_all_peripherals(self):
        """Stops all simulated devices."""
        log.info("Stopping all simulated devices...")
        all_addresses = list(self.peripherals.keys())
        tasks = [self.disconnect_from_device(addr) for addr in all_addresses]
        await asyncio.gather(*tasks, return_exceptions=True)


# Global manager instance
_global_manager: Optional[SimulatedConnectionManager] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager - same structure as main.py"""
    global _global_manager
    log.info("Starting BLE Simulator API (platform=%s)", sys.platform)
    
    # Get number of boxes from environment or use default
    num_boxes = int(os.getenv("SIMULATOR_NUM_BOXES", str(DEFAULT_NUM_BOXES)))
    
    # 1. Create the manager
    _global_manager = SimulatedConnectionManager(num_boxes=num_boxes)
    
    # 2. Configure and connect MQTT client
    mqtt_kwargs = {"hostname": MQTT_BROKER, "port": MQTT_PORT}
    if MQTT_USERNAME:
        mqtt_kwargs["username"] = MQTT_USERNAME
    if MQTT_PASSWORD:
        mqtt_kwargs["password"] = MQTT_PASSWORD
        
    if MQTT_TLS:
        tls_context = ssl.create_default_context(cafile=MQTT_CA_FILE)
        if os.path.exists(MQTT_CERT_FILE) and os.path.exists(MQTT_KEY_FILE):
            tls_context.load_cert_chain(certfile=MQTT_CERT_FILE, keyfile=MQTT_KEY_FILE)
        if MQTT_TLS_INSECURE:
             tls_context.check_hostname = False
             tls_context.verify_mode = ssl.CERT_NONE
        mqtt_kwargs["tls_context"] = tls_context
    
    mqtt_client_context = aiomqtt.Client(**mqtt_kwargs)
    async with mqtt_client_context as mqtt_client:
        _global_manager.mqtt_client = mqtt_client
        log.info("Connected to MQTT broker at %s:%d", MQTT_BROKER, MQTT_PORT)
        
        try:
            yield
        finally:
            log.info("Shutting down... disconnecting all simulated devices.")
            await _global_manager.stop_all_peripherals()
            log.info("Shutdown complete.")


app = FastAPI(title="BLE Simulator API", lifespan=lifespan)


@app.get("/scan")
async def scan_devices():
    """Simulates a BLE scan - returns available simulated devices."""
    if _global_manager is None:
        raise HTTPException(status_code=503, detail="Simulator manager not initialized")
    
    try:
        log.info("API: Received /scan request.")
        results = await _global_manager.scan_for_devices()
        return JSONResponse(content=results)
    except Exception as e:
        log.exception("Unexpected error during scan: %s", e)
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


@app.post("/connect/{address}")
async def connect_device(address: str):
    """Simulates connecting to a device - starts sending mock sensor data."""
    if _global_manager is None:
        raise HTTPException(status_code=503, detail="Simulator manager not initialized")
    
    try:
        await _global_manager.connect_to_device(address)
        return JSONResponse(content={"status": "connecting", "address": address})
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/disconnect/{address}")
async def disconnect_device(address: str):
    """Simulates disconnecting from a device - stops sending data."""
    if _global_manager is None:
        raise HTTPException(status_code=503, detail="Simulator manager not initialized")
    
    try:
        await _global_manager.disconnect_from_device(address)
        return JSONResponse(content={"status": "disconnected", "address": address})
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.get("/connections")
async def get_active_connections():
    """Returns a list of all actively connected simulated devices."""
    if _global_manager is None:
        raise HTTPException(status_code=503, detail="Simulator manager not initialized")
    
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
        "mqtt_connected": _global_manager and _global_manager.mqtt_client is not None,
        "simulator_mode": True
    })


async def main():
    """Main entry point - runs FastAPI server."""
    port = int(os.getenv("BLE_API_PORT", "8080"))
    host = os.getenv("BLE_API_HOST", "0.0.0.0")
    
    log.info("Starting BLE Simulator HTTP API on %s:%d", host, port)
    config = uvicorn.Config(app, host=host, port=port, log_level="info")
    server = uvicorn.Server(config)
    await server.serve()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log.info("Exited via KeyboardInterrupt")
    except Exception as e:
        log.exception("Fatal error running simulator: %s", e)