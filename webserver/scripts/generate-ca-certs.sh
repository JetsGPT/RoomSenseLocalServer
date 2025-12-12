#!/bin/bash
set -e

# ==============================================================================
# RoomSense Local CA & Certificate Generator
# ==============================================================================

# 1. Path Setup
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CERT_DIR="$(realpath "${SCRIPT_DIR}/../certs")"

# Output files
CA_KEY="${CERT_DIR}/rootCA.key"
CA_CERT="${CERT_DIR}/rootCA.crt"
SERVER_KEY="${CERT_DIR}/server.key"
SERVER_CSR="${CERT_DIR}/server.csr"
SERVER_CERT="${CERT_DIR}/server.cert"
EXT_FILE="${CERT_DIR}/server.ext"

echo "📍 Script location: ${SCRIPT_DIR}"
echo "📂 Cert output dir: ${CERT_DIR}"

mkdir -p "${CERT_DIR}"

# ==============================================================================
# 2. Generate Root CA (The Authority)
# ==============================================================================
# Only generate if it doesn't exist. This file must stay consistent!
if [[ -f "${CA_KEY}" && -f "${CA_CERT}" ]]; then
    echo "✅ Root CA already exists. Using existing Authority."
else
    echo "🔐 Generating new Root CA..."
    
    # Generate CA Private Key
    openssl genrsa -out "${CA_KEY}" 4096

    # Generate Root Certificate (Valid for 10 years)
    openssl req -x509 -new -nodes -key "${CA_KEY}" -sha256 -days 3650 \
        -out "${CA_CERT}" \
        -subj "/C=US/ST=State/L=City/O=RoomSense-Local-Authority/CN=RoomSense Root CA"
    
    echo "✨ Created rootCA.crt (Import this file to your devices/browsers!)"
fi

# ==============================================================================
# 3. Generate Server Certificate (Signed by CA)
# ==============================================================================

# Create Server Config for SANs (Subject Alternative Names)
# We accept roomsense.local, localhost, and standard local IPs
cat > "${EXT_FILE}" <<EOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage = digitalSignature, nonRepudiation, keyEncipherment, dataEncipherment
subjectAltName = @alt_names

[alt_names]
DNS.1 = roomsense.local
DNS.2 = localhost
DNS.3 = influxdb
DNS.4 = blegateway
DNS.5 = mosquitto
DNS.6 = roomsense_webserver
IP.1 = 127.0.0.1
IP.2 = 0.0.0.0
# You can add static IPs here if known, e.g., IP.3 = 192.168.1.50
EOF

echo "🔑 Generating Server Key and CSR..."
openssl req -new -newkey rsa:4096 -nodes \
    -keyout "${SERVER_KEY}" \
    -out "${SERVER_CSR}" \
    -subj "/C=US/ST=State/L=City/O=RoomSense/CN=roomsense.local"

echo "✍️  Signing Server Certificate with Root CA..."
openssl x509 -req -in "${SERVER_CSR}" \
    -CA "${CA_CERT}" -CAkey "${CA_KEY}" -CAcreateserial \
    -out "${SERVER_CERT}" \
    -days 825 -sha256 \
    -extfile "${EXT_FILE}"

# Cleanup intermediate files
rm "${SERVER_CSR}" "${EXT_FILE}"

# Set Permissions
# CA Key is strictly confidential (600)
chmod 600 "${CA_KEY}"
# Server Key is confidential (600)
chmod 600 "${SERVER_KEY}"
# Public certs are readable (644)
chmod 644 "${CA_CERT}" "${SERVER_CERT}"

echo ""
echo "✅ Certificates Generated Successfully!"
echo "   ---------------------------------------------------------"
echo "   1. Server Key:  ${SERVER_KEY}"
echo "   2. Server Cert: ${SERVER_CERT} (Signed by CA)"
echo "   3. Root CA:     ${CA_CERT}  <-- INSTALL THIS ON CLIENTS"
echo "   ---------------------------------------------------------"
