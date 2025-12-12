# Scripts Directory

This directory contains all scripts for the RoomSense Local Server project.

## Structure

```
scripts/
├── init/              # Initialization and startup scripts
│   ├── start.sh       # Main startup script (initializes Swarm and secrets)
│   └── init-swarm-secrets.sh  # Internal script for secret generation
│
└── entrypoints/       # Docker entrypoint wrappers for services
    ├── telegraf-entrypoint.sh
    ├── postgres-entrypoint-wrapper.sh
    └── influxdb-entrypoint-wrapper.sh
```

## Initialization Scripts (`init/`)

### `start.sh` / `start.ps1`
Main startup script that:
- Checks Docker availability
- Initializes Docker Swarm (if needed)
- Generates and creates Docker Swarm secrets
- Starts all containers with `docker compose up -d`

**Usage:**
- **Linux/macOS/Git Bash:**
  ```bash
  ./scripts/init/start.sh
  ```
- **Windows PowerShell:**
  ```powershell
  .\scripts\init\start.ps1
  ```

### `init-swarm-secrets.sh`
Internal script used for secret initialization. Generates cryptographically secure secrets using OpenSSL.

## Utility Scripts

### `generate-ca-certs.sh`
Generates a local Root Certificate Authority (CA) and server certificates signed by it. This replaces simple self-signed certificates.

**Usage:**
- **Linux/macOS/Git Bash:**
  ```bash
  ./scripts/generate-ca-certs.sh
  ```
- **Windows PowerShell:**
  Use Git Bash or WSL to run the bash script.

## Entrypoint Scripts (`entrypoints/`)

These scripts are mounted into containers and load secrets from Docker Swarm before starting services.

### `telegraf-entrypoint.sh`
Loads InfluxDB token from `/run/secrets/influx_token` and sets `INFLUX_TOKEN` environment variable.

### `postgres-entrypoint-wrapper.sh`
Loads PostgreSQL password from `/run/secrets/pgpassword` and sets `POSTGRES_PASSWORD` environment variable before calling the original PostgreSQL entrypoint.

### `influxdb-entrypoint-wrapper.sh`
Loads InfluxDB password and token from Docker Swarm secrets and sets environment variables before calling the original InfluxDB entrypoint.

## Security

All scripts follow security best practices:
- Secrets are read from Docker Swarm secrets (mounted at `/run/secrets/`)
- No secrets are hardcoded or logged
- Each service only receives the secrets it needs
- Scripts use proper error handling and validation

