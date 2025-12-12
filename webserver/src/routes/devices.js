import express from 'express';
import { requireLogin } from '../auth/auth.js';
import pg from 'pg';

const router = express.Router();
const { Pool } = pg;

// Database connection pool (will be injected from app.js)
let pool = null;

// Enforce authentication
const authMiddleware = requireLogin;

// BLE Gateway API endpoint
const BLE_GATEWAY_URL = process.env.BLE_GATEWAY_URL || 'http://blegateway:8080';
const SCAN_TIMEOUT_MS = 10000; // 10 seconds max (Python scan is 8s + 2s buffer)
const REQUEST_TIMEOUT_MS = 5000; // 5 seconds for faster requests

/**
 * Generic error handler for proxying requests to the BLE gateway.
 * This centralizes the complex error logic you already wrote.
 */
async function proxyToGateway(res, url, options, timeout = REQUEST_TIMEOUT_MS) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(url, {
            ...options,
            signal: controller.signal,
            headers: {
                ...options.headers,
                'Content-Type': 'application/json',
                'X-API-Key': process.env.BLE_GATEWAY_API_KEY || '',
            },
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorText = await response.text();
            let errorJson;
            try {
                // The Python API returns JSON { "detail": "..." }
                errorJson = JSON.parse(errorText);
            } catch (e) {
                errorJson = { detail: errorText || 'Unknown error' };
            }

            const detail = errorJson.detail || 'No details provided';

            // Re-map Python status codes to appropriate Express status codes
            switch (response.status) {
                case 404:
                    return res.status(404).json({ error: 'Not Found', detail });
                case 503:
                    return res.status(503).json({ error: 'BLE bridge service unavailable', detail });
                case 504:
                    return res.status(504).json({ error: 'BLE operation timed out', detail });
                case 500:
                    return res.status(502).json({ error: 'BLE bridge internal error', detail });
                default:
                    return res.status(502).json({ error: 'BLE bridge returned an error', detail });
            }
        }

        const data = await response.json();
        return res.status(200).json(data);

    } catch (error) {
        if (error.name === 'AbortError' || error.name === 'TimeoutError') {
            console.warn(`BLE gateway request to ${url} timed out after ${timeout}ms`);
            return res.status(504).json({
                error: 'Request timeout',
                detail: `Gateway request exceeded ${timeout}ms`
            });
        }

        if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
            console.error('Cannot connect to BLE gateway:', error.message);
            return res.status(503).json({
                error: 'BLE bridge unavailable',
                detail: 'Cannot connect to BLE gateway container.'
            });
        }

        console.error('Error calling BLE gateway:', error);
        return res.status(500).json({
            error: 'Internal server error',
            detail: error.message || 'Unexpected error occurred'
        });
    }
}

// --- Original Endpoint ---

// --- Original Endpoint ---

/**
 * GET /api/devices/scan
 * Triggers a BLE scan via the Python BLE bridge.
 * Overlays known device names from the database over the raw advertised names.
 */
router.get('/scan', authMiddleware, async (req, res) => {
    try {
        // 1. Start the gateway scan (this takes ~8-10 seconds)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS);

        const response = await fetch(`${BLE_GATEWAY_URL}/scan`, {
            method: 'GET',
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': process.env.BLE_GATEWAY_API_KEY || '',
            },
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            // Handle errors (same as proxyToGateway logic)
            const errorText = await response.text();
            let detail = 'No details provided';
            try { detail = JSON.parse(errorText).detail || detail; } catch (e) { }

            if (response.status === 503) return res.status(503).json({ error: 'BLE bridge service unavailable', detail });
            if (response.status === 504) return res.status(504).json({ error: 'BLE operation timed out', detail });
            return res.status(502).json({ error: 'BLE bridge returned an error', detail });
        }

        const scanResults = await response.json();

        // 2. Fetch known names from the database
        if (pool) {
            try {
                const dbResult = await pool.query('SELECT address, name, display_name FROM ble_connections');
                const knownDevices = new Map();
                dbResult.rows.forEach(row => {
                    // Store by uppercase address for case-insensitive matching
                    if (row.address) {
                        knownDevices.set(row.address.toUpperCase(), row);
                    }
                });

                // 3. Overlay known names onto scan results
                if (Array.isArray(scanResults)) {
                    scanResults.forEach(device => {
                        if (!device.address) return;

                        const upperAddress = device.address.toUpperCase();

                        // Default original_name to the advertised name if not already set
                        if (!device.original_name) {
                            device.original_name = device.name;
                        }

                        if (knownDevices.has(upperAddress)) {
                            const known = knownDevices.get(upperAddress);

                            // original_name: Immutable technical name (from DB or keep existing)
                            if (known.name) {
                                device.original_name = known.name;
                            }

                            // name: User-friendly alias (display_name) -> Technical Name (name) -> Advertised Name
                            if (known.display_name) {
                                device.name = known.display_name;
                            } else if (known.name) {
                                device.name = known.name;
                            }
                        }
                    });
                }
            } catch (dbError) {
                console.error('[BLE] Failed to fetch known devices from DB:', dbError);
                // Continue with raw scan results if DB fails
            }
        }

        return res.status(200).json(scanResults);

    } catch (error) {
        if (error.name === 'AbortError' || error.name === 'TimeoutError') {
            return res.status(504).json({ error: 'Request timeout', detail: `Scan exceeded ${SCAN_TIMEOUT_MS}ms` });
        }
        console.error('Error during scan:', error);
        return res.status(500).json({ error: 'Internal server error', detail: error.message });
    }
});

// --- New Endpoints ---

/**
 * GET /api/devices/connections
 * Gets the list of currently active BLE connections from the gateway.
 * Overlays display names from the database.
 */
router.get('/connections', authMiddleware, async (req, res) => {
    try {
        // 1. Get raw connections from gateway
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        const response = await fetch(`${BLE_GATEWAY_URL}/connections`, {
            method: 'GET',
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': process.env.BLE_GATEWAY_API_KEY || '',
            },
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            // Error handling similar to proxyToGateway
            const errorText = await response.text();
            let detail = 'No details provided';
            try { detail = JSON.parse(errorText).detail || detail; } catch (e) { }
            return res.status(response.status).json({ error: 'BLE gateway error', detail });
        }

        const connections = await response.json();

        // 2. Overlay display names from DB
        if (pool && Array.isArray(connections)) {
            try {
                const dbResult = await pool.query('SELECT address, name, display_name FROM ble_connections');
                const knownDevices = new Map();
                dbResult.rows.forEach(row => {
                    if (row.address) {
                        knownDevices.set(row.address.toUpperCase(), row);
                    }
                });

                const updates = [];

                connections.forEach(conn => {
                    if (!conn.address) return;

                    const upperAddress = conn.address.toUpperCase();

                    // Default original_name: Use box_name if available (from gateway), else advertised name
                    if (conn.box_name) {
                        conn.original_name = conn.box_name;
                    } else if (!conn.original_name) {
                        conn.original_name = conn.name;
                    }

                    if (knownDevices.has(upperAddress)) {
                        const known = knownDevices.get(upperAddress);

                        // Sync DB name with box_name if different (and box_name exists)
                        // This ensures InfluxDB queries (which use box_name) work with the alias resolution
                        if (conn.box_name && known.name !== conn.box_name) {
                            console.log(`[BLE] Updating technical name for ${conn.address} from '${known.name}' to '${conn.box_name}'`);
                            updates.push(pool.query(
                                'UPDATE ble_connections SET name = $1, updated_at = NOW() WHERE UPPER(address) = $2',
                                [conn.box_name, upperAddress]
                            ));
                            // Update local known object for this response
                            known.name = conn.box_name;
                        }

                        // original_name: Technical ID (DB > Gateway Box Name > Advertised Name)
                        if (known.name) {
                            conn.original_name = known.name;
                        }

                        // name: Display alias -> Technical ID
                        if (known.display_name) {
                            conn.name = known.display_name;
                        } else if (known.name) {
                            conn.name = known.name;
                        } else if (conn.box_name) {
                            conn.name = conn.box_name;
                        }
                    } else if (conn.box_name) {
                        // If not in DB but has box_name, use it as display name too
                        conn.name = conn.box_name;
                    }
                });

                // Execute updates in background (don't block response too long, but good to await for error handling)
                if (updates.length > 0) {
                    Promise.allSettled(updates).then(results => {
                        results.forEach((res, idx) => {
                            if (res.status === 'rejected') {
                                console.error(`[BLE] Failed to update name for device:`, res.reason);
                            }
                        });
                    });
                }
            } catch (dbError) {
                console.error('[BLE] Failed to fetch known devices for connections:', dbError);
            }
        }

        return res.status(200).json(connections);

    } catch (error) {
        console.error('Error getting connections:', error);
        return res.status(500).json({ error: 'Internal server error', detail: error.message });
    }
});

/**
 * POST /api/devices/connect/:address
 * Requests the gateway to connect to a specific device by its address.
 * Also persists the connection to the database.
 */
router.post('/connect/:address', authMiddleware, async (req, res) => {
    const { address } = req.params;
    if (!address) {
        return res.status(400).json({ error: 'Missing device address' });
    }

    // Get device name from request body if provided
    // This is treated as the technical ID (name) if it's a new device
    const deviceName = req.body?.name || null;

    // Check for name uniqueness if a name is provided
    if (deviceName && pool) {
        try {
            // Check if name is used as 'name' OR 'display_name' by another device
            const nameCheck = await pool.query(
                `SELECT address FROM ble_connections 
                 WHERE (name = $1 OR display_name = $1) 
                 AND address != $2`,
                [deviceName, address]
            );
            if (nameCheck.rows.length > 0) {
                return res.status(409).json({
                    error: 'Name conflict',
                    detail: `The name '${deviceName}' is already used by device ${nameCheck.rows[0].address}`
                });
            }
        } catch (dbError) {
            console.error('[BLE] DB error checking name uniqueness:', dbError);
        }
    }

    // First, try to connect via the gateway
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        const response = await fetch(`${BLE_GATEWAY_URL}/connect/${encodeURIComponent(address)}`, {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': process.env.BLE_GATEWAY_API_KEY || '',
            },
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorText = await response.text();
            let errorJson;
            try {
                errorJson = JSON.parse(errorText);
            } catch (e) {
                errorJson = { detail: errorText || 'Unknown error' };
            }
            const detail = errorJson.detail || 'No details provided';

            switch (response.status) {
                case 404:
                    return res.status(404).json({ error: 'Not Found', detail });
                case 503:
                    return res.status(503).json({ error: 'BLE bridge service unavailable', detail });
                case 504:
                    return res.status(504).json({ error: 'BLE operation timed out', detail });
                default:
                    return res.status(502).json({ error: 'BLE bridge returned an error', detail });
            }
        }

        const data = await response.json();

        // If connection successful, persist to database
        if (pool && data.status === 'connecting') {
            try {
                // Only update 'name' (technical ID) if it's not set or if explicitly provided for new device
                // We do NOT update display_name here, that's done via rename endpoint
                await pool.query(
                    `INSERT INTO ble_connections (address, name, connected_at, last_seen, is_active)
                     VALUES ($1, $2, NOW(), NOW(), TRUE)
                     ON CONFLICT (address) 
                     DO UPDATE SET 
                         name = COALESCE(ble_connections.name, $2), -- Keep existing name if present
                         connected_at = NOW(),
                         last_seen = NOW(),
                         is_active = TRUE`,
                    [address, deviceName]
                );
                console.log(`[BLE] Persisted connection for device ${address}`);
            } catch (dbError) {
                console.error(`[BLE] Failed to persist connection to database:`, dbError);
            }
        }

        return res.status(200).json(data);

    } catch (error) {
        if (error.name === 'AbortError' || error.name === 'TimeoutError') {
            return res.status(504).json({
                error: 'Request timeout',
                detail: `Gateway request exceeded ${REQUEST_TIMEOUT_MS}ms`
            });
        }
        if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
            return res.status(503).json({
                error: 'BLE bridge unavailable',
                detail: 'Cannot connect to BLE gateway container.'
            });
        }
        console.error('Error calling BLE gateway:', error);
        return res.status(500).json({
            error: 'Internal server error',
            detail: error.message || 'Unexpected error occurred'
        });
    }
});

/**
 * PATCH /api/devices/connect/:address
 * Updates the display name (alias) of a device.
 */
router.patch('/connect/:address', authMiddleware, async (req, res) => {
    const { address } = req.params;
    const { display_name } = req.body;

    if (!address) return res.status(400).json({ error: 'Missing address' });
    if (!pool) return res.status(503).json({ error: 'Database not available' });

    try {
        // Check uniqueness for display_name
        if (display_name) {
            const nameCheck = await pool.query(
                `SELECT address FROM ble_connections 
                 WHERE (name = $1 OR display_name = $1) 
                 AND address != $2`,
                [display_name, address]
            );
            if (nameCheck.rows.length > 0) {
                return res.status(409).json({
                    error: 'Name conflict',
                    detail: `The name '${display_name}' is already used.`
                });
            }
        }

        const result = await pool.query(
            `UPDATE ble_connections 
             SET display_name = $1, updated_at = NOW()
             WHERE address = $2
             RETURNING address, name, display_name`,
            [display_name || null, address]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Device not found' });
        }

        return res.status(200).json(result.rows[0]);

    } catch (error) {
        console.error('[BLE] Error updating display name:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/devices/disconnect/:address
 * Requests the gateway to disconnect from a specific device.
 * Also marks the connection as inactive in the database.
 */
router.post('/disconnect/:address', authMiddleware, async (req, res) => {
    const { address } = req.params;
    if (!address) {
        return res.status(400).json({ error: 'Missing device address' });
    }

    // First, try to disconnect via the gateway
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        const response = await fetch(`${BLE_GATEWAY_URL}/disconnect/${encodeURIComponent(address)}`, {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': process.env.BLE_GATEWAY_API_KEY || '',
            },
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorText = await response.text();
            let errorJson;
            try {
                errorJson = JSON.parse(errorText);
            } catch (e) {
                errorJson = { detail: errorText || 'Unknown error' };
            }
            const detail = errorJson.detail || 'No details provided';

            switch (response.status) {
                case 404:
                    return res.status(404).json({ error: 'Not Found', detail });
                case 503:
                    return res.status(503).json({ error: 'BLE bridge service unavailable', detail });
                default:
                    return res.status(502).json({ error: 'BLE bridge returned an error', detail });
            }
        }

        const data = await response.json();

        // If disconnection successful, mark as inactive in database
        if (pool && data.status === 'disconnected') {
            try {
                await pool.query(
                    `UPDATE ble_connections 
                     SET is_active = FALSE, last_seen = NOW()
                     WHERE address = $1`,
                    [address]
                );
                console.log(`[BLE] Marked connection as inactive for device ${address}`);
            } catch (dbError) {
                console.error(`[BLE] Failed to update connection in database:`, dbError);
                // Don't fail the request if DB write fails
            }
        }

        return res.status(200).json(data);

    } catch (error) {
        if (error.name === 'AbortError' || error.name === 'TimeoutError') {
            return res.status(504).json({
                error: 'Request timeout',
                detail: `Gateway request exceeded ${REQUEST_TIMEOUT_MS}ms`
            });
        }
        if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
            return res.status(503).json({
                error: 'BLE bridge unavailable',
                detail: 'Cannot connect to BLE gateway container.'
            });
        }
        console.error('Error calling BLE gateway:', error);
        return res.status(500).json({
            error: 'Internal server error',
            detail: error.message || 'Unexpected error occurred'
        });
    }
});

/**
 * GET /api/devices/health
 * Checks the health of the BLE gateway service.
 */
router.get('/health', authMiddleware, async (req, res) => {
    await proxyToGateway(
        res,
        `${BLE_GATEWAY_URL}/health`,
        { method: 'GET' }
    );
});

/**
 * Initialize the database pool for this router
 * Called from app.js to inject the pool
 */
export function initDatabasePool(databasePool) {
    pool = databasePool;
}

/**
 * Restore persisted BLE connections from database on startup
 * This should be called after the server starts
 */
export async function restorePersistedConnections() {
    if (!pool) {
        console.warn('[BLE] Database pool not initialized, skipping connection restoration');
        return;
    }

    // Retry logic for database connection
    let result;
    const MAX_RETRIES = 10;
    const RETRY_DELAY = 3000;

    for (let i = 0; i < MAX_RETRIES; i++) {
        try {
            // Get all active connections from database
            result = await pool.query(
                `SELECT address, name FROM ble_connections WHERE is_active = TRUE`
            );
            break; // Success, exit loop
        } catch (error) {
            console.warn(`[BLE] Database connection attempt ${i + 1}/${MAX_RETRIES} failed: ${error.message}`);
            if (i === MAX_RETRIES - 1) {
                console.error('[BLE] Failed to connect to database after multiple attempts, skipping connection restoration');
                return;
            }
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
        }
    }

    if (!result || result.rows.length === 0) {
        console.log('[BLE] No persisted connections to restore');
        return;
    }

    console.log(`[BLE] Restoring ${result.rows.length} persisted connection(s)...`);

    // Restore each connection
    const restorePromises = result.rows.map(async (row) => {
        const { address, name } = row;
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

            const response = await fetch(`${BLE_GATEWAY_URL}/connect/${encodeURIComponent(address)}`, {
                method: 'POST',
                signal: controller.signal,
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': process.env.BLE_GATEWAY_API_KEY || '',
                },
            });

            clearTimeout(timeoutId);

            if (response.ok) {
                console.log(`[BLE] Successfully restored connection to ${address} (${name || 'unknown'})`);
                // Update last_seen timestamp
                await pool.query(
                    `UPDATE ble_connections SET last_seen = NOW() WHERE address = $1`,
                    [address]
                );
            } else {
                console.warn(`[BLE] Failed to restore connection to ${address}: ${response.status}`);
                // Mark as inactive if connection fails
                await pool.query(
                    `UPDATE ble_connections SET is_active = FALSE WHERE address = $1`,
                    [address]
                );
            }
        } catch (error) {
            console.error(`[BLE] Error restoring connection to ${address}:`, error.message);
            // Mark as inactive on error
            try {
                await pool.query(
                    `UPDATE ble_connections SET is_active = FALSE WHERE address = $1`,
                    [address]
                );
            } catch (dbError) {
                console.error(`[BLE] Failed to update database for ${address}:`, dbError);
            }
        }
    });

    await Promise.allSettled(restorePromises);
    console.log('[BLE] Connection restoration completed');
}

export default router;