# Docker Configuration Guide

This guide explains how to configure the RoomSense Local Server for different environments (Raspberry Pi/Linux Swarm vs. Windows/Mac Development).

## Default Configuration (Raspberry Pi / Docker Swarm)

The default configuration is now optimized for **Raspberry Pi running Docker Swarm**. It assumes that services communicate with each other using their internal Docker service names.

**Defaults:**
- `BLE_GATEWAY_URL`: `http://blegateway:8080`
- `MQTT_BROKER`: `mosquitto`

**No `.env` file is required** for the standard Raspberry Pi setup. The application will automatically use these defaults if no `.env` file is present.

## Windows / Mac Development Configuration

If you are developing on Windows or Mac and running the webserver in a container but other services (like the BLE gateway or MQTT broker) might be running differently or you need to access host services, you **MUST** override the defaults using an `.env` file.

### How to Configure for Windows/Mac

1.  Create a `.env` file in the `webserver` directory.
2.  Add the following overrides to point to the host machine's network:

```env
# Point to the host machine for services running outside the swarm/container network
# or if you are using Docker Desktop's host networking magic
BLE_GATEWAY_URL=http://host.docker.internal:8080
MQTT_BROKER=host.docker.internal
```

### Why is this necessary?
- **Raspberry Pi (Linux)**: Docker containers can talk to each other directly by service name (`blegateway`, `mosquitto`) within the Swarm network. `host.docker.internal` is not natively supported or needed in the same way.
- **Windows/Mac (Docker Desktop)**: Often requires `host.docker.internal` to access services running on the host machine or to bridge certain networking gaps during development.

## Summary of Variables

| Variable | Default (Pi/Swarm) | Windows/Dev Recommended | Description |
| :--- | :--- | :--- | :--- |
| `BLE_GATEWAY_URL` | `http://blegateway:8080` | `http://host.docker.internal:8080` | URL for the BLE Gateway API |
| `MQTT_BROKER` | `mosquitto` | `host.docker.internal` | Hostname/IP of the MQTT Broker |
| `MQTT_PORT` | `1883` | `1883` | Port for the MQTT Broker |

## Bluetooth Hardware Access on Raspberry Pi

The `blegateway` service attempts to access the Raspberry Pi's Bluetooth adapter by mounting the **DBus socket** (`/var/run/dbus`).

### If Scanning Fails (Bluetooth Adapter Not Found)
If you see errors like "Bluetooth adapter not available" in the logs, you may need to enable **Host Networking** for the `blegateway` service. This gives the container full access to the host's network hardware.

**Steps to Enable Host Networking:**

1.  **Edit `compose.yaml`**:
    - Find the `blegateway` service.
    - Uncomment `ports` section (if you want to access it directly) OR better yet:
    - Add `networks:` section with `host` mode (Note: Swarm syntax differs slightly, often `network_mode: host` is ignored in `deploy` block or requires specific version).
    - **Recommended for Swarm**: It is often easier to run the `blegateway` as a standalone container (not part of the stack) or use `network_mode: host` if supported by your Docker version.

    *Alternative (Simpler for Swarm)*:
    Add `cap_add: [NET_ADMIN]` to the `blegateway` service in `compose.yaml` (though this is ignored in Swarm mode usually).

    **The most reliable fix for Swarm** if DBus fails is to run the gateway separately:
    ```bash
    docker run -d --name roomsense-blegateway \
      --net=host \
      --restart unless-stopped \
      -v /var/run/dbus:/var/run/dbus \
      -e MQTT_BROKER=localhost \
      roomsense-blegateway:latest
    ```

2.  **Update Configuration**:
    If you run `blegateway` on the host network (or separately), it is no longer on the internal `roomsense-network`. You must update `BLE_GATEWAY_URL`:
    - Create/Edit `.env`:
      ```env
      BLE_GATEWAY_URL=http://172.17.0.1:8080
      # OR use the Pi's actual LAN IP
      BLE_GATEWAY_URL=http://192.168.x.x:8080
      ```

