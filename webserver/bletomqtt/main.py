#!/usr/bin/env python3
"""
multi_ble_to_mqtt.py

Discovers multiple BLE peripherals exposing the same custom GATT characteristic,
subscribes to notifications, and republishes them as MQTT messages.

Requires:
    pip install bleak asyncio-mqtt

Example usage:
    python multi_ble_to_mqtt.py
"""
# TODO: This is ChatGPT code, understand it and make it better for our use, also: descriptor and second characteristic
# TODO: Also, this is for asyncio-mqtt, but that is depreciated, so have to update it to aiomqtt

import asyncio
import logging
import struct
from typing import Dict, Optional

from bleak import BleakClient, BleakScanner, BleakError
from aiomqtt import Client as MQTTClient, MqttError

# ---------- Configuration ----------
CUSTOM_SERVICE_UUID = "cfa59c64-aeaf-42ac-bf8d-bc4a41ef5b0c"
CUSTOM_SENSOR_CHAR_UUID = "49c92b70-42f5-49c3-bc38-5fe05b3df8e0"
CUSTOM_SENSOR_DESCRIPTOR_UUID = "3bee5811-4c6c-449a-b368-0b1391c6c1dc"
CUSTOM_BOX_CHAR_UUID = "9d62dc0c-b4ef-40c4-9383-15bdc16870de"

SCAN_INTERVAL = 10.0
MQTT_BROKER = "localhost"
MQTT_PORT = 1883
MQTT_TOPIC_BASE = "ble/devices"  # messages will go to ble/devices/<address>
MQTT_USERNAME = None  # optional
MQTT_PASSWORD = None
# -----------------------------------

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s: %(message)s")
log = logging.getLogger("ble_to_mqtt")


def parse_payload(b: bytes) -> dict:
    """
    Parse the BLE notification payload into a dictionary for MQTT.
    Adjust this to match your peripheral's data format.
    """
    if not b:
        return {"raw": None}

    # Example: try to parse struct (uint32 + float)
    if len(b) == 8:
        try:
            u32, fl = struct.unpack("<If", b)
            return {"uint32": u32, "float": fl}
        except Exception:
            pass

    # Try UTF-8
    try:
        s = b.decode("utf-8").strip()
        return {"text": s}
    except Exception:
        pass

    # Fallback: hex string
    return {"hex": " ".join(f"{x:02x}" for x in b)}


class BLEPeripheral:
    """Handles connection and data forwarding for one BLE peripheral."""

    def __init__(self, address: str, name: str, mqtt_client: MQTTClient):
        self.address = address
        self.name = name or "unknown"
        self.client: Optional[BleakClient] = None
        self.mqtt = mqtt_client
        self._task: Optional[asyncio.Task] = None
        self._stopping = False

    async def _on_notify(self, sender: int, data: bytearray):
        parsed = parse_payload(bytes(data))
        payload = {
            "address": self.address,
            "name": self.name,
            "data": parsed,
        }
        topic = f"{MQTT_TOPIC_BASE}/{self.address.replace(':', '').lower()}"
        try:
            await self.mqtt.publish(topic, str(payload))
            log.info("[%s] → MQTT %s : %s", self.address, topic, parsed)
        except MqttError as e:
            log.warning("[%s] MQTT publish error: %s", self.address, e)

    async def connect_and_listen(self):
        """Maintain BLE connection and forward notifications."""
        backoff = 1
        while not self._stopping:
            try:
                self.client = BleakClient(self.address, timeout=10.0)
                log.info("[%s] Connecting...", self.address)
                await self.client.connect()
                log.info("[%s] Connected", self.address)

                def _on_disconnect(_client):
                    log.warning("[%s] Disconnected.", self.address)

                self.client.set_disconnected_callback(_on_disconnect)

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
    """Manages discovery and multiple BLE → MQTT pipelines."""

    def __init__(self):
        self.peripherals: Dict[str, BLEPeripheral] = {}
        self._stopping = False

    async def scan_for_devices(self):
        """Find devices advertising our target service."""
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
        """Run main scan and connect loop with MQTT."""
        mqtt_kwargs = {"hostname": MQTT_BROKER, "port": MQTT_PORT}
        if MQTT_USERNAME:
            mqtt_kwargs["username"] = MQTT_USERNAME
        if MQTT_PASSWORD:
            mqtt_kwargs["password"] = MQTT_PASSWORD

        async with MQTTClient(**mqtt_kwargs) as mqtt:
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
