#!/bin/bash
# Generate SSL certificates for roomsense.local
# Saves files to /certs regardless of where the script is run

set -e

# 1. Set explicit absolute path
CERT_DIR="/certs"

KEY_FILE="${CERT_DIR}/server.key"
CERT_FILE="${CERT_DIR}/server.cert"
# These are the files nginx-proxy looks for (VIRTUAL_HOST match)
HOST_CERT_FILE="${CERT_DIR}/roomsense.local.crt"
HOST_KEY_FILE="${CERT_DIR}/roomsense.local.key"
OPENSSL_CNF="${CERT_DIR}/openssl_roomsense.cnf"

# 2. Create the directory if it doesn't exist
# (Requires sudo if /certs is at the root of the filesystem)
mkdir -p "${CERT_DIR}"

echo "Working directory is set to: ${CERT_DIR}"

# Check if certificates already exist
if &&; then
    echo "Certificates already exist in ${CERT_DIR}"
    read -p "Do you want to regenerate them? (y/N): " -n 1 -r
    echo
    if$ ]]; then
        echo "Keeping existing certificates."
        exit 0
    fi
    echo "Regenerating certificates..."
fi

# Create an OpenSSL config with Subject Alternative Names
cat > "${OPENSSL_CNF}" <<EOF
[ req ]
default_bits       = 4096
distinguished_name = dn
req_extensions     = req_ext
x509_extensions    = req_ext
prompt             = no

[ dn ]
C  = US
ST = State
L  = City
O  = RoomSense
CN = roomsense.local

[ req_ext ]
subjectAltName = @alt_names

[ alt_names ]
DNS.1 = roomsense.local
DNS.2 = localhost
EOF

# Generate self-signed certificate with SANs
echo "Generating self-signed SSL certificate..."
openssl req -x509 -newkey rsa:4096 \
    -keyout "${KEY_FILE}" \
    -out "${CERT_FILE}" \
    -days 3650 \
    -nodes \
    -config "${OPENSSL_CNF}"

# Copy to the specific filenames nginx-proxy expects
# We use 'cp' to ensure we have the copies named correctly for the VIRTUAL_HOST
cp "${CERT_FILE}" "${HOST_CERT_FILE}"
cp "${KEY_FILE}" "${HOST_KEY_FILE}"

# Set permissions (Read/Write for owner, Read for group/others)
chmod 644 "${CERT_FILE}" "${HOST_CERT_FILE}"
chmod 600 "${KEY_FILE}" "${HOST_KEY_FILE}"

# Cleanup temp config
rm "${OPENSSL_CNF}"

echo ""
echo "✅ Success!"
echo "   Certificates stored in: ${CERT_DIR}"
echo "   Nginx-Proxy File:       ${HOST_CERT_FILE}"
echo ""