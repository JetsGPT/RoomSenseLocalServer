#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEBROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
HOSTCTL_SCRIPT="${WEBROOT}/scripts/host-control/roomsense-hostctl.mjs"
RUNTIME_DIR="${ROOMSENSE_HOSTCTL_RUNTIME_DIR:-${WEBROOT}/host-control-runtime}"
SOCKET_PATH="${ROOMSENSE_HOSTCTL_SOCKET:-${RUNTIME_DIR}/hostctl.sock}"
ENV_FILE="/etc/default/roomsense-hostctl"
SERVICE_FILE="/etc/systemd/system/roomsense-hostctl.service"
NODE_BIN="$(command -v node || true)"

run_as_root() {
    if [ "${EUID}" -eq 0 ]; then
        "$@"
        return
    fi

    if ! command -v sudo >/dev/null 2>&1; then
        echo "[roomsense-hostctl] sudo is required to install the host control helper." >&2
        return 1
    fi

    sudo "$@"
}

if [ ! -f "${HOSTCTL_SCRIPT}" ]; then
    echo "[roomsense-hostctl] Helper script not found at ${HOSTCTL_SCRIPT}" >&2
    exit 1
fi

if [ -z "${NODE_BIN}" ]; then
    echo "[roomsense-hostctl] Node.js is required on the Raspberry Pi host." >&2
    exit 1
fi

if ! command -v systemctl >/dev/null 2>&1; then
    echo "[roomsense-hostctl] systemd is not available on this host; skipping host helper installation."
    exit 0
fi

echo "[roomsense-hostctl] Installing host control helper..."
run_as_root mkdir -p "${RUNTIME_DIR}/jobs"
run_as_root chmod 700 "${RUNTIME_DIR}/jobs"

TMP_ENV="$(mktemp)"
TMP_SERVICE="$(mktemp)"

cat > "${TMP_ENV}" <<EOF
ROOMSENSE_HOSTCTL_SOCKET=${SOCKET_PATH}
ROOMSENSE_HOSTCTL_SOCKET_UID=1000
ROOMSENSE_HOSTCTL_SOCKET_GID=1000
ROOMSENSE_WIFI_INTERFACE=
ROOMSENSE_WIFI_RESCAN=auto
EOF

cat > "${TMP_SERVICE}" <<EOF
[Unit]
Description=RoomSense Host Control Helper
After=network-online.target NetworkManager.service
Wants=network-online.target

[Service]
Type=simple
User=root
Group=root
EnvironmentFile=-${ENV_FILE}
WorkingDirectory=${WEBROOT}
ExecStart=${NODE_BIN} ${HOSTCTL_SCRIPT}
Restart=always
RestartSec=2
UMask=0077
PrivateTmp=true
ProtectHome=true
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

run_as_root install -D -m 600 "${TMP_ENV}" "${ENV_FILE}"
run_as_root install -D -m 644 "${TMP_SERVICE}" "${SERVICE_FILE}"
run_as_root systemctl daemon-reload
run_as_root systemctl enable --now roomsense-hostctl.service

rm -f "${TMP_ENV}" "${TMP_SERVICE}"

echo "[roomsense-hostctl] Host control helper installed and running."
