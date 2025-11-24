#!/bin/bash
# Generate SSL certificates for the webserver
# This creates self-signed certificates for HTTPS

set -e

CERT_DIR="certs"
KEY_FILE="${CERT_DIR}/server.key"
CERT_FILE="${CERT_DIR}/server.cert"

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

# Generate self-signed certificate
echo "Generating self-signed SSL certificate..."
openssl req -x509 -newkey rsa:4096 \
    -keyout "${KEY_FILE}" \
    -out "${CERT_FILE}" \
    -days 365 \
    -nodes \
    -subj "/C=US/ST=State/L=City/O=RoomSense/CN=localhost"

# Set proper permissions
chmod 600 "${KEY_FILE}"
chmod 644 "${CERT_FILE}"

echo ""
echo "✅ SSL certificates generated successfully!"
echo "   Key:  ${KEY_FILE}"
echo "   Cert: ${CERT_FILE}"
echo ""
echo "⚠️  Note: These are self-signed certificates for development."
echo "   For production, use certificates from a trusted CA."

