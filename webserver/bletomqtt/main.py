#!/usr/bin/env python3

import sys
import asyncio
import time

if sys.platform.startswith("win"):
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

import logging
import struct
from typing import Dict, Optional

from bleak import BleakClient, BleakScanner, BleakError
import aiomqtt

# ---------- Configuration ----------
CUSTOM_SERVICE_UUID = "cfa59c64-aeaf-42ac-bf8d-bc4a41ef5b0c"
CUSTOM_SENSOR_CHAR_UUID = "49c92b70-42f5-49c3-bc38-5fe05b3df8e0"
CUSTOM_SENSOR_DESCRIPTOR_UUID = "3bee5811-4c6c-449a-b368-0b1391c6c1dc"
CUSTOM_BOX_CHAR_UUID = "9d62dc0c-b4ef-40c4-9383-15bdc16870de"

SCAN_INTERVAL = 10.0
MQTT_BROKER = "localhost"
MQTT_PORT = 1883
MQTT_TOPIC_BASE = "ble/devices"
MQTT_USERNAME = None
MQTT_PASSWORD = None
# -----------------------------------

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s: %(message)s")
log = logging.getLogger("ble_to_mqtt")


class BLEPeripheral:
    def __init__(self, address: str, name: str, mqtt_client: aiomqtt.Client):
        self.address = address
        self.name = name or "unknown"
        self.client: Optional[BleakClient] = None
        self.mqtt = mqtt_client
        self._task: Optional[asyncio.Task] = None
        self._stopping = False
        self.sensor_type: Optional[str] = None
        self.box_address: Optional[str] = None

    async def _read_metadata(self):
        try:
            desc_data = await self.client.read_gatt_descriptor(CUSTOM_SENSOR_DESCRIPTOR_UUID)
            self.sensor_type = desc_data.decode(errors="ignore").strip()

            box_data = await self.client.read_gatt_char(CUSTOM_BOX_CHAR_UUID)
            self.box_address = box_data.decode(errors="ignore").strip()

            log.info("[%s] Descriptor: %s | Box: %s", self.address, self.sensor_type, self.box_address)
        except Exception as e:
            log.warning("[%s] Could not read descriptor/box info: %s", self.address, e)

    async def _on_notify(self, sender: int, data: bytearray):
        parsed = self._parse_sensor_value(data)
        payload = {
            "sensor_box": self.box_address or "unknown",
            "sensor_type": self.sensor_type or "unknown",
            "value": parsed,
        }

        topic = f"{MQTT_TOPIC_BASE}/{self.box_address or self.address.replace(':', '').lower()}"
        try:
            await self.mqtt.publish(topic, str(payload).encode())
            log.info("[%s] → MQTT %s : %s", self.address, topic, payload)
        except aiomqtt.MqttError as e:
            log.warning("[%s] MQTT publish error: %s", self.address, e)

    def _parse_sensor_value(self, data: bytes):
        if not data:
            return None
        try:
            if len(data) == 4:
                val = struct.unpack("<f", data)[0]
                return round(val, 3)
            elif len(data) == 2:
                return struct.unpack("<h", data)[0]
            elif len(data) == 8:
                return struct.unpack("<d", data)[0]
            else:
                return int.from_bytes(data, byteorder="little", signed=True)
        except Exception:
            try:
                return float(data.decode().strip())
            except Exception:
                return None

    async def connect_and_listen(self):
        backoff = 1
        while not self._stopping:
            try:
                self.client = BleakClient(self.address, timeout=10.0)
                log.info("[%s] Connecting...", self.address)
                await self.client.connect()
                log.info("[%s] Connected", self.address)

                def _on_disconnect(_client):
                    log.warning("[%s] Disconnected.", self.address)

                self.client.disconnected_callback = _on_disconnect

                await self._read_metadata()

                await self.client.start_notify(CUSTOM_SENSOR_CHAR_UUID, self._on_notify)
                log.info("[%s] Subscribed to %s", self.address, CUSTOM_SENSOR_CHAR_UUID)
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
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 30)

    def start(self):
        self._task = asyncio.create_task(self.connect_and_listen())

    async def stop(self):
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
            await self._task


class BLEToMQTTBridge:

    def __init__(self):
        self.peripherals: Dict[str, BLEPeripheral] = {}
        self._stopping = False

    async def scan_for_devices(self):
        log.info("Scanning for devices advertising %s ...", CUSTOM_SERVICE_UUID)
        devices = await BleakScanner.discover(timeout=5.0)
        found = []
        for d in devices:
            uuids = (getattr(d, "metadata", {}) or {}).get("uuids", [])
            uuids = [u.lower() for u in uuids] or []
            if CUSTOM_SERVICE_UUID.lower() in uuids:
                found.append(d)
        return found

    async def run(self):
        mqtt_kwargs = {
            "hostname": MQTT_BROKER,
            "port": MQTT_PORT,
        }
        if MQTT_USERNAME:
            mqtt_kwargs["username"] = MQTT_USERNAME
        if MQTT_PASSWORD:
            mqtt_kwargs["password"] = MQTT_PASSWORD

        async with aiomqtt.Client(**mqtt_kwargs) as mqtt:
            log.info("Connected to MQTT broker at %s:%d", MQTT_BROKER, MQTT_PORT)

            while not self._stopping:
                try:
                    devices = await self.scan_for_devices()
                    for d in devices:
                        if d.address not in self.peripherals:
                            log.info("New BLE device: %s (%s)", d.name, d.address)
                            conn = BLEPeripheral(d.address, d.name, mqtt)
                            self.peripherals[d.address] = conn
                            conn.start()

                    await asyncio.sleep(SCAN_INTERVAL)
                except Exception as e:
                    log.warning("Scan loop error: %s", e)
                    await asyncio.sleep(SCAN_INTERVAL)

    async def stop(self):
        self._stopping = True
        log.info("Stopping BLE→MQTT bridge...")
        await asyncio.gather(*(p.stop() for p in self.peripherals.values()), return_exceptions=True)
        log.info("Stopped all connections.")


async def main():
    bridge = BLEToMQTTBridge()
    task = asyncio.create_task(bridge.run())
    try:
        while True:
            await asyncio.sleep(1)
    except KeyboardInterrupt:
        log.info("KeyboardInterrupt, stopping.")
    finally:
        await bridge.stop()
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)


if __name__ == "__main__":
    asyncio.run(main())
