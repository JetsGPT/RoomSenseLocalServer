# Certificates Directory

This directory contains SSL/TLS certificates for the application.

## Files

- `server.cert` - SSL certificate file
- `server.key` - SSL private key file (required)

## Certificate Generation

### Quick Generation

**On Linux/macOS or Git Bash:**
```bash
./scripts/generate-certs.sh
```

**On Windows PowerShell:**
```powershell
.\scripts\generate-certs.ps1
```

### Manual Generation

For development, you can generate a self-signed certificate manually:

```bash
openssl req -x509 -newkey rsa:4096 -keyout certs/server.key -out certs/server.cert -days 365 -nodes
```

**Security Note:** Self-signed certificates are for development only. For production, use certificates from a trusted Certificate Authority (CA).

## Certificate Location

The application reads certificates from this directory:
- Certificate: `certs/server.cert`
- Private Key: `certs/server.key`

These paths are configured in `src/app.js`. The application will fail to start if these files are missing.

## Troubleshooting

### Missing server.key

If you see the error: `ENOENT: no such file or directory, open './certs/server.key'`

**Solution:** Generate the certificates using one of the methods above.

