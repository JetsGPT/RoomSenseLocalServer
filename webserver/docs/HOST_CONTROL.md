# Raspberry Pi Host Control

RoomSense now supports Raspberry Pi reboot and Wi-Fi switching through a small host-side helper service.

## Why it exists

The backend runs inside Docker, but rebooting the Pi and changing host Wi-Fi must happen on the Raspberry Pi host itself. The helper exposes a very small allowlist over a Unix socket:

- `GET /health`
- `GET /wifi/status`
- `GET /wifi/networks`
- `POST /wifi/connect`
- `POST /reboot`

The backend connects to that socket from inside the container. No generic command execution is exposed.

## Runtime layout

- Host helper script: `webserver/scripts/host-control/roomsense-hostctl.mjs`
- Host installer: `webserver/scripts/host-control/install-hostctl.sh`
- Host runtime directory: `webserver/host-control-runtime/`
- Socket inside container: `/run/roomsense-hostctl/hostctl.sock`
- Socket on host by default: `webserver/host-control-runtime/hostctl.sock`

`compose.yaml` bind-mounts `./host-control-runtime` into the `webserver` container at `/run/roomsense-hostctl`.

## Installation

On Raspberry Pi and other Linux hosts using systemd, `scripts/init/start.sh` now attempts to install the helper automatically before deploying the stack.

You can also install or refresh it manually:

```bash
cd webserver
bash ./scripts/host-control/install-hostctl.sh
```

The installer writes:

- systemd env file: `/etc/default/roomsense-hostctl`
- systemd service: `/etc/systemd/system/roomsense-hostctl.service`

Then it enables and starts `roomsense-hostctl.service`.

## Requirements

- Linux host with `systemd`
- `node` available on the Raspberry Pi host
- `NetworkManager` / `nmcli` for Wi-Fi management
- RoomSense deployed from the repository checkout so the helper script path remains valid

## Security model

- The helper is reachable only through a Unix socket, not a TCP port.
- The helper only exposes reboot and Wi-Fi operations.
- Passwords are never logged.
- The socket is chmod/chown'ed for the RoomSense container user (`uid/gid 1000` by default).

## Environment overrides

Set these on the host helper if you need overrides:

- `ROOMSENSE_HOSTCTL_SOCKET`
- `ROOMSENSE_HOSTCTL_SOCKET_UID`
- `ROOMSENSE_HOSTCTL_SOCKET_GID`
- `ROOMSENSE_WIFI_INTERFACE`
- `ROOMSENSE_WIFI_RESCAN`

Set these for the backend container if you need overrides:

- `HOST_CONTROL_SOCKET`
- `HOST_CONTROL_TIMEOUT_MS`
- `HOST_CONTROL_SCAN_TIMEOUT_MS`
