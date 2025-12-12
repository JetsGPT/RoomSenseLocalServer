# Certificates Directory

This directory contains SSL/TLS certificates for the application.

## Files

- `rootCA.crt` - Root Certificate Authority (Trust this on client devices)
- `rootCA.key` - CA Private Key (Keep secret)
- `server.cert` - Server SSL certificate signed by Root CA
- `server.key` - Server Private Key

## Certificate Generation

### Generation Script

**On Linux/macOS or Git Bash:**
```bash
./scripts/generate-ca-certs.sh
```

This will create:
1. A Root CA (`rootCA.crt` and `rootCA.key`) if they don't exist.
2. A server certificate valid for `roomsense.local`, `localhost`, and common IPs, signed by the Root CA.

### Trusting the CA

To stop browser warnings, import `rootCA.crt` into your device's Trusted Root Certification Authorities store.

## Certificate Location

The application reads certificates from this directory:
- Certificate: `certs/server.cert`
- Private Key: `certs/server.key`

These paths are configured in `src/app.js`. The application will fail to start if these files are missing.

## Troubleshooting

### Missing server.key

If you see the error: `ENOENT: no such file or directory, open './certs/server.key'`

**Solution:** Generate the certificates using one of the methods above.

