# RoomSenseLocalServer

The local Server which will run on the raspberry pi and is the business logic between the data and the user.

## 📖 Overview
RoomSenseLocalServer is a comprehensive, secure backend built with Node.js and Express. It acts as the central hub for managing smart home devices, processing sensor data, and serving the frontend application. Designed to be deployed via Docker Swarm, it utilizes a robust microservices architecture to handle time-series data, persistent configurations, and real-time MQTT/BLE communications.

## ✨ Features
* **Secure REST API**: Fully functional HTTPS web server serving API routes for users, sensors, devices, floor plans, weather, and system settings.
* **Advanced Security**: Implements strict CSRF protection, PostgreSQL-backed session management, CORS configuration, and Role-Based Access Control (RBAC) with rate limiting.
* **Data Storage**: 
  * **PostgreSQL**: Stores relational data including user accounts, roles, permissions, and device configurations.
  * **InfluxDB**: Optimized time-series database for high-performance sensor data storage and retrieval.
* **IoT & Connectivity**: Integrates a BLE (Bluetooth Low Energy) Gateway and an Eclipse Mosquitto MQTT broker for seamless device communication.
* **Automation & Intelligence**: Features a built-in Notification Rule Engine and integrates AI services (via Google GenAI) for intelligent data processing.
* **Frontend Hosting**: Statically serves the built React frontend directly from the server with optimized caching strategies.

## 🏗️ Architecture & Services
The application is deployed as a Docker Swarm stack comprising the following core services:

1. **`webserver`**: The main Node.js/Express backend application.
2. **`postgres`**: PostgreSQL (v17.4) database for persistent application state.
3. **`influxdb`**: InfluxDB (v2.7.11) for managing time-series sensor metrics.
4. **`blegateway`**: Python-based service for bridging BLE devices to the MQTT broker.
5. **`mosquitto`**: Eclipse Mosquitto MQTT broker supporting secure (8883) and standard (1883) protocols.
6. **`telegraf`**: Metric collection agent routing data to InfluxDB.
7. **`nginx`**: Reverse proxy handling external HTTPS traffic.

## 🚀 Tech Stack
* **Backend**: Node.js, Express.js
* **Databases**: PostgreSQL (`pg`, `connect-pg-simple`), InfluxDB (`@influxdata/influxdb-client`)
* **Protocols**: HTTPS, WebSocket (`ws`), MQTT
* **Deployment**: Docker, Docker Swarm
* **Security**: `csurf`, `cookie-parser`, Docker Secrets

## 🔐 Security & Secrets Management
This project prioritizes security by utilizing **Docker Swarm Secrets** instead of hardcoded environment variables. Secrets are mounted into containers at runtime. Required secrets include:
* `session_secret`, `pgpassword`, `influx_password`, `influx_token`, `mqtt_password`, `webapp_password`, `ble_gateway_api_key`
* SSL/TLS Certificates: `ssl_server_key`, `ssl_server_cert`, `ssl_root_ca`

## 🛠️ API Structure
The server exposes several modular API endpoints:
* `/api/users` - User authentication and management
* `/api/sensors` - Sensor data ingestion and retrieval
* `/api/devices` - Device state and connection management
* `/api/floor-plans` - Spatial and room configurations
* `/api/notifications` - Rule engine and alerts
* `/api/weather` - External weather integrations
* `/api/ai` - Generative AI features
* `/api/system` & `/api/setup` - System health, logs, and initial bootstrapping

## 💻 Getting Started
*(Note: Requires Docker Swarm mode to be enabled on the host machine)*

1. Ensure Docker Swarm is initialized (`docker swarm init`).
2. Generate and store all required Docker secrets.
3. Build the custom images (e.g., `roomsense-webserver:latest`, `roomsense-blegateway:latest`).
4. Deploy the stack:
   ```bash
   docker stack deploy -c compose.yaml roomsense
