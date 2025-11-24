# Source Code Directory

This directory contains all application source code for the RoomSense Local Server.

## Structure

```
src/
├── app.js              # Main application entry point
├── loadSecrets.js      # Environment variable and secrets loader
├── auth/               # Authentication utilities
│   └── auth.js         # Login and role-based access control
├── middleware/         # Express middleware
│   └── ratePermissions.js  # Rate limiting and permissions
└── routes/             # API route handlers
    ├── devices.js      # BLE device management endpoints
    ├── users.js        # User management endpoints
    ├── testing.js      # Testing endpoints
    └── sensors/        # Sensor data endpoints
        ├── index.js
        ├── dataRetrieval.js
        ├── dataWriting.js
        ├── influxClient.js
        └── utils.js
```

## Entry Point

The application starts from `app.js`, which:
1. Loads environment variables and secrets using `loadSecrets.js`
2. Sets up Express server with middleware
3. Configures database connections
4. Registers API routes
5. Starts HTTPS server on port 8081

## Environment Variables

The application uses:
- `.env` file for non-sensitive configuration
- Docker Swarm secrets for sensitive data (passwords, tokens)
- See `../docs/SECURE_SETUP.md` for details

## Dependencies

All dependencies are listed in `../package.json` and installed via `npm install`.

