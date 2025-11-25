#!/bin/bash
# Generate SSL certificates for the webserver
# This creates self-signed certificates for HTTPS with proper SANs for roomsense.local

set -e

CERT_DIR="certs"
KEY_FILE="${CERT_DIR}/server.key"
CERT_FILE="${CERT_DIR}/server.cert"
HOST_CERT_FILE="${CERT_DIR}/roomsense.local.crt"
HOST_KEY_FILE="${CERT_DIR}/roomsense.local.key"
OPENSSL_CNF="${CERT_DIR}/openssl_roomsense.cnf"

# Get script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${PROJECT_ROOT}"

# Create certs directory if it doesn't exist
mkdir -p "${CERT_DIR}"

# Check if certificates already exist
if [ -f "${KEY_FILE}" ] && [ -f "${CERT_FILE}" ]; then
    echo "Certificates already exist at:"
    echo "  - ${KEY_FILE}"
    echo "  - ${CERT_FILE}"
    echo ""
    read -p "Do you want to regenerate them? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Keeping existing certificates."
        exit 0
    fi
    echo "Regenerating certificates..."
fi

# Create an OpenSSL config with Subject Alternative Names for roomsense.local
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
echo "Generating self-signed SSL certificate for roomsense.local (with SAN)..."
openssl req -x509 -newkey rsa:4096 \
    -keyout "${KEY_FILE}" \
    -out "${CERT_FILE}" \
    -days 365 \
    -nodes \
    -config "${OPENSSL_CNF}"

# Also provide host-specific filenames that nginx-proxy expects
cp "${CERT_FILE}" "${HOST_CERT_FILE}"
cp "${KEY_FILE}" "${HOST_KEY_FILE}"

# Set proper permissions
chmod 600 "${KEY_FILE}" "${HOST_KEY_FILE}"
chmod 644 "${CERT_FILE}" "${HOST_CERT_FILE}"

echo ""
echo "✅ SSL certificates generated successfully!"
echo "   Key:        ${KEY_FILE}"
echo "   Cert:       ${CERT_FILE}"
echo "   Host cert:  ${HOST_CERT_FILE}"
echo "   Host key:   ${HOST_KEY_FILE}"
echo ""
echo "⚠️  Note: These are self-signed certificates for development."
echo "   For production, use certificates from a trusted CA."
