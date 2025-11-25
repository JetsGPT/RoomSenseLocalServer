#!/bin/bash
set -e

# 1. Reliable Path Resolution
# Get the directory where this script is physically located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE}")" && pwd)"

# Set CERT_DIR to be a sibling of the script directory
# (e.g. if script is in /scripts, this becomes /certs)
CERT_DIR="$(realpath "${SCRIPT_DIR}/../certs")"

KEY_FILE="${CERT_DIR}/roomsense.local.key"
CERT_FILE="${CERT_DIR}/roomsense.local.crt"
OPENSSL_CNF="${CERT_DIR}/openssl_roomsense.cnf"

echo "📍 Script location: ${SCRIPT_DIR}"
echo "📂 Cert output dir: ${CERT_DIR}"

# 2. Create directory if missing
mkdir -p "${CERT_DIR}"

# 3. Check for existing certs (FIXED)
if &&; then
    echo "✅ Certificates already exist in ${CERT_DIR}"
    echo "   Skipping generation to prevent overwrite."
    echo "   (Delete these files manually if you want to regenerate)"
    exit 0
fi

# 4. Generate Configuration
cat > "${OPENSSL_CNF}" <<EOF
[ req ]
default_bits       = 4096
distinguished_name = dn
req_extensions     = req_ext
x509_extensions    = req_ext
prompt             = no

[ dn ]
C  = US
O  = RoomSense
CN = roomsense.local

[ req_ext ]
subjectAltName = @alt_names

[ alt_names ]
DNS.1 = roomsense.local
DNS.2 = localhost
EOF

# 5. Generate Certificates (One Step)
echo "🔑 Generating self-signed certificate..."
openssl req -x509 -newkey rsa:4096 -sha256 -days 3650 \
    -nodes \
    -keyout "${KEY_FILE}" \
    -out "${CERT_FILE}" \
    -config "${OPENSSL_CNF}"

# Cleanup config
rm "${OPENSSL_CNF}"

# Set permissions
chmod 644 "${CERT_FILE}"
chmod 600 "${KEY_FILE}"

echo ""
echo "✅ Success! Certificates generated:"
echo "   ${CERT_FILE}"
echo "   ${KEY_FILE}"