#!/usr/bin/env python3
import sys
import asyncio
import logging
import struct
from typing import Dict, Optional

# ---- Windows event loop for Bleak ----
if sys.platform.startswith("win"):
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from bleak import BleakClient, BleakScanner, BleakError
import aiomqtt
import json
import time

# ---------- Configuration ----------
CUSTOM_SERVICE_UUID = "cfa59c64-aeaf-42ac-bf8d-bc4a41ef5b0c".lower()
CUSTOM_SENSOR_CHAR_UUID = "49c92b70-42f5-49c3-bc38-5fe05b3df8e0".lower()
CUSTOM_SENSOR_TYPE_DESC_UUID = "3bee5811-4c6c-449a-b368-0b1391c6c1dc".lower()
CUSTOM_BOX_CHAR_UUID = "9d62dc0c-b4ef-40c4-9383-15bdc16870de".lower()

TARGET_NAME = "TempSensor01"

SCAN_DURATION = 8.0
SCAN_INTERVAL = 10.0
MQTT_BROKER = "mosquitto"
#MQTT_PORT = 1883
MQTT_TOPIC_BASE = "ble/devices"
MQTT_USERNAME = None
MQTT_PASSWORD = None

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s: %(message)s")
log = logging.getLogger("ble_to_mqtt")


class BLEPeripheral:
    def __init__(self, device, name: str, mqtt_client: aiomqtt.Client):
        self.device = device
        self.address = device.address
        self.name = name or "unknown"
        self.client: Optional[BleakClient] = None
        self.mqtt = mqtt_client
        self._task: Optional[asyncio.Task] = None
        self._stopping = False
        self.box_address: Optional[str] = None  # sensor_type removed

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

            # Find descriptor by UUID
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
        except Exception as e:
            log.warning("[%s] Failed to read sensor type descriptor: %s", self.address, e)
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

    async def connect_and_listen(self):
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

                # Subscribe to sensor data notifications
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


# ================================================================
# BLE → MQTT Bridge
# ================================================================
class BLEToMQTTBridge:
    def __init__(self):
        self.peripherals: Dict[str, BLEPeripheral] = {}
        self._stopping = False

    async def scan_for_devices(self):
        log.info("Scanning for devices (name=%r or service=%s) ...", TARGET_NAME, CUSTOM_SERVICE_UUID)
        seen: Dict[str, dict] = {}

        def detection_cb(device, advertisement_data):
            addr = device.address
            uuids = [u.lower() for u in (advertisement_data.service_uuids or [])]
            name = advertisement_data.local_name or device.name
            seen[addr] = {"device": device, "name": name or "", "uuids": uuids}

        scanner = BleakScanner(detection_cb)
        await scanner.start()
        await asyncio.sleep(SCAN_DURATION)
        await scanner.stop()

        matches = []
        for addr, info in seen.items():
            name = info["name"]
            uuids = info["uuids"]
            if (name == TARGET_NAME) or (CUSTOM_SERVICE_UUID in uuids):
                log.info("Found candidate: %s (%s) uuids=%s", name or "(no name)", addr, uuids)
                matches.append(info["device"])
        return matches

    async def run(self):
        mqtt_kwargs = {"hostname": MQTT_BROKER}#, "port": MQTT_PORT}
        if MQTT_USERNAME:
            mqtt_kwargs["username"] = MQTT_USERNAME
        if MQTT_PASSWORD:
            mqtt_kwargs["password"] = MQTT_PASSWORD

        async with aiomqtt.Client(**mqtt_kwargs) as mqtt:
            log.info("Connected to MQTT broker at %s")#, MQTT_BROKER)

            while not self._stopping:
                try:
                    devices = await self.scan_for_devices()
                    for d in devices:
                        if d.address not in self.peripherals:
                            log.info("New BLE device: %s (%s)", d.name, d.address)
                            conn = BLEPeripheral(d, d.name, mqtt)
                            self.peripherals[d.address] = conn
                            conn.start()

                    await asyncio.sleep(SCAN_INTERVAL)
                except Exception as e:
                    log.warning("Scan loop error: %s", e)
                    await asyncio.sleep(SCAN_INTERVAL)

    async def stop(self):
        self._stopping = True
        log.info("Stopping BLEMQTT bridge...")
        await asyncio.gather(*(p.stop() for p in self.peripherals.values()), return_exceptions=True)
        log.info("Stopped all connections.")


# ================================================================
# Main
# ================================================================
async def main():
    log.info("Starting BLE -> MQTT bridge (platform=%s python=%s)", sys.platform, sys.version.split()[0])
    bridge = BLEToMQTTBridge()
    task = asyncio.create_task(bridge.run())
    try:
        while True:
            await asyncio.sleep(1)
    except KeyboardInterrupt:
        log.info("KeyboardInterrupt, stopping.")
    except asyncio.CancelledError:
        log.info("Main task cancelled, stopping.")
    except Exception as e:
        log.exception("Unhandled exception in main loop: %s", e)
    finally:
        await bridge.stop()
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log.info("Exited via KeyboardInterrupt")
    except Exception as e:
        log.exception("Fatal error running main: %s", e)
        raise