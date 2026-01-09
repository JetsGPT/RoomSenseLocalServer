import asyncio
from bleak import BleakScanner

async def main():
    print("Scanning for 10 seconds...")
    scanner = BleakScanner()
    await scanner.start()
    await asyncio.sleep(10.0)
    await scanner.stop()

    print("\nDiscovered Devices:")
    for d, adv in scanner.discovered_devices_and_advertisement_data.values():
        name_from_os = d.name or "<None>"
        local_name = adv.local_name or "<None>"
        service_uuids = adv.service_uuids
        rssi = adv.rssi
        
        print(f"Address: {d.address}")
        print(f"  Name (OS): {name_from_os}")
        print(f"  Local Name (Adv): {local_name}")
        print(f"  RSSI: {rssi}")
        print(f"  Service UUIDs: {service_uuids}")
        print("-" * 40)

if __name__ == "__main__":
    asyncio.run(main())
