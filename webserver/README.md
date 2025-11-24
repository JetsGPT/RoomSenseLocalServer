# RoomSense Local Server

A secure, containerized local server for RoomSense IoT sensor management with Docker Swarm secrets management.

## Project Structure

```
webserver/
├── src/                    # Application source code
│   ├── app.js              # Main application entry point
│   ├── loadSecrets.js      # Secrets and environment loader
│   ├── auth/               # Authentication utilities
│   ├── middleware/         # Express middleware
│   └── routes/             # API route handlers
│
├── scripts/                # Automation scripts
│   ├── init/               # Initialization scripts
│   │   ├── start.sh        # Main startup script
│   │   └── init-swarm-secrets.sh
│   └── entrypoints/        # Docker entrypoint wrappers
│
├── docs/                   # Documentation
│   ├── SECURE_SETUP.md     # Secure setup guide
│   └── ...                 # Additional documentation
│
├── database/               # SQL scripts
│   └── add_devices_permission.sql
│
├── logs/                   # Application logs
│
├── certs/                  # SSL certificates
├── postgres-init/          # PostgreSQL initialization
├── telegraf/               # Telegraf configuration
├── mosquitto/              # MQTT broker configuration
├── bletomqtt/              # BLE Gateway service
│
├── compose.yaml            # Docker Compose configuration
├── Dockerfile              # Main application Dockerfile
├── package.json            # Node.js dependencies
└── .env                    # Non-sensitive configuration (create this in root)
```

## Quick Start

1. **Start the system:**
   
   **On Linux/macOS or Git Bash:**
   ```bash
   ./scripts/init/start.sh
   ```
   
   **On Windows PowerShell:**
   ```powershell
   .\scripts\init\start.ps1
   ```

2. **The script will:**
   - Initialize Docker Swarm
   - Generate secure secrets automatically
   - Start all containers

3. **Access the application:**
   - HTTPS Server: `https://localhost:8081`
   - InfluxDB: `https://localhost:8086`
   - MQTT Broker: `localhost:1883`

## Configuration

### Environment Variables

Create a `.env` file in the **root of the webserver directory** (same directory as `compose.yaml`) for non-sensitive configuration:

```env
PGHOST=postgres
PGUSER=postgres
PGPORT=5432
PGDATABASE=user
INFLUX_URL=https://influxdb:8086
INFLUX_ORG=RoomSense
INFLUX_BUCKET=sensors_data
# ... see docs/README_ENV.md for full list
```

**Note:** Sensitive values (passwords, tokens, session secrets) are automatically managed by Docker Swarm secrets. Do NOT put them in `.env`.

## Security

This project uses Docker Swarm secrets for secure management of sensitive data:

- **Cryptographically secure secret generation** using OpenSSL
- **Least privilege access** - each container only gets the secrets it needs
- **Encrypted storage** - secrets are encrypted at rest by Docker Swarm
- **Automatic initialization** - secrets are generated on first startup

See **[docs/SECURE_SETUP.md](./docs/SECURE_SETUP.md)** for complete security documentation.

## Documentation

- **[docs/SECURE_SETUP.md](./docs/SECURE_SETUP.md)** - Complete secure setup guide
- **[docs/README.md](./docs/README.md)** - Documentation index
- **[scripts/README.md](./scripts/README.md)** - Scripts documentation
- **[src/README.md](./src/README.md)** - Source code documentation

## Services

- **webserver** - Main Node.js application (port 8081)
- **postgres** - PostgreSQL database (port 5432)
- **influxdb** - InfluxDB time-series database (port 8086)
- **telegraf** - Metrics collection agent
- **mosquitto** - MQTT broker (port 1883)
- **blegateway** - BLE Gateway service
- **nginx-proxy-manager** - Reverse proxy (ports 80, 81, 443)

## Development

### Running Locally

```bash
# Start all services
./scripts/init/start.sh

# View logs
docker compose logs -f

# Stop services
docker compose down
```

### Project Structure

- **Application Code**: `src/` directory
- **Scripts**: `scripts/` directory
- **Documentation**: `docs/` directory
- **Database Scripts**: `database/` directory
- **Logs**: `logs/` directory

## License

[Add your license here]

## Support

For issues and questions, please refer to the documentation in the `docs/` directory.

