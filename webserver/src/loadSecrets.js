// Load environment variables from .env file and Docker Swarm secrets
// Priority: .env file > Docker secrets > process.env defaults
// Security: Secrets are mounted at /run/secrets by Docker Swarm

import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

const SECRETS_DIR = '/run/secrets';
const ENV_FILE = '.env';

/**
 * Read a secret from Docker Swarm secrets directory
 * @param {string} secretName - Name of the secret file
 * @returns {string|null} - Secret value or null if not found
 */
function readSecret(secretName) {
    const secretPath = path.join(SECRETS_DIR, secretName);
    try {
        if (fs.existsSync(secretPath)) {
            // Read secret and remove any CR/LF characters to prevent line ending issues
            // This matches the entrypoint scripts which use: tr -d '\r\n'
            const secret = fs.readFileSync(secretPath, 'utf8').replace(/\r\n/g, '').replace(/\n/g, '').replace(/\r/g, '');
            return secret;
        }
    } catch (error) {
        // Silently fail if secret doesn't exist
        console.warn(`Warning: Could not read secret ${secretName}: ${error.message}`);
    }
    return null;
}

/**
 * Load environment variables with proper priority
 * 1. .env file (highest priority - for non-sensitive config)
 * 2. Docker Swarm secrets (for sensitive values)
 * 3. Existing process.env (from compose.yaml or system)
 */
export function loadEnvironment() {
    // Step 1: Load .env file if it exists (for non-sensitive configuration)
    // This allows users to override non-sensitive settings
    if (fs.existsSync(ENV_FILE)) {
        console.log('✓ Loading non-sensitive configuration from .env file');
        dotenv.config();
    } else {
        console.log('ℹ️  No .env file found, using Docker secrets and defaults');
    }

    // Step 2: Load sensitive values from Docker Swarm secrets
    // Only set if not already set by .env file (respecting priority)
    const secrets = {
        SESSION_SECRET: 'session_secret',
        PGPASSWORD: 'pgpassword',
        INFLUX_PASSWORD: 'influx_password',
        INFLUX_TOKEN: 'influx_token',
    };

    let secretsLoaded = 0;
    for (const [envVar, secretName] of Object.entries(secrets)) {
        // Only load from secret if not already set (by .env file)
        if (!process.env[envVar]) {
            const secretValue = readSecret(secretName);
            if (secretValue) {
                process.env[envVar] = secretValue;
                secretsLoaded++;
                console.log(`✓ Loaded ${envVar} from Docker secret`);
            } else {
                console.warn(`⚠️  ${envVar} not found in secrets and not in .env`);
            }
        } else {
            console.log(`ℹ️  ${envVar} already set (from .env or environment)`);
        }
    }

    if (secretsLoaded > 0) {
        console.log(`✓ Loaded ${secretsLoaded} secret(s) from Docker Swarm`);
    }

    // Step 3: Set defaults for non-sensitive variables if not set
    const defaults = {
        PGHOST: 'postgres',
        PGUSER: 'postgres',
        PGPORT: '5432',
        PGDATABASE: 'user',
        INFLUX_URL: 'https://influxdb:8086',
        INFLUX_ORG: 'RoomSense',
        INFLUX_BUCKET: 'sensors_data',
        INFLUX_USERNAME: 'admin',
        MQTT_BROKER: 'mosquitto',
        MQTT_PORT: '1883',
        BLE_GATEWAY_URL: 'http://blegateway:8080',
        DEV_BYPASS_AUTH: '0',
        TRUST_PROXY: '0',
        RATE_LIMIT_TRUST_PROXY: '0',
        PERM_CACHE_MS: '30000',
    };

    for (const [key, value] of Object.entries(defaults)) {
        if (!process.env[key]) {
            process.env[key] = value;
        }
    }

    // Validate critical variables
    if (!process.env.SESSION_SECRET) {
        throw new Error('SESSION_SECRET is required but not set. Ensure secrets are initialized.');
    }

    console.log('✓ Environment variables loaded and validated');
}

