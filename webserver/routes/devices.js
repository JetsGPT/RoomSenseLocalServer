import express from 'express';
import { requireLogin } from '../auth/auth.js';
import pg from 'pg';

const router = express.Router();
const { Pool } = pg;

// Database connection pool (will be injected from app.js)
let pool = null;

// Dev mode: bypass auth if DEV_BYPASS_AUTH is set
const authMiddleware = process.env.DEV_BYPASS_AUTH === '1' 
    ? (req, res, next) => next()  // Skip auth in dev mode
    : requireLogin;  // Require auth in production

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

/**
 * GET /api/devices/scan
 * Triggers a BLE scan via the Python BLE bridge.
 */
router.get('/scan', authMiddleware, async (req, res) => {
    await proxyToGateway(
        res, 
        `${BLE_GATEWAY_URL}/scan`, 
        { method: 'GET' }, 
        SCAN_TIMEOUT_MS // Use longer timeout for scanning
    );
});

// --- New Endpoints ---

/**
 * GET /api/devices/connections
 * Gets the list of currently active BLE connections from the gateway.
 */
router.get('/connections', authMiddleware, async (req, res) => {
    await proxyToGateway(
        res,
        `${BLE_GATEWAY_URL}/connections`,
        { method: 'GET' }
    );
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
    
    // Get device name from request body if provided, or from scan results
    const deviceName = req.body?.name || null;
    
    // First, try to connect via the gateway
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        const response = await fetch(`${BLE_GATEWAY_URL}/connect/${encodeURIComponent(address)}`, {
            method: 'POST',
            signal: controller.signal,
            headers: { 'Content-Type': 'application/json' },
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
                await pool.query(
                    `INSERT INTO ble_connections (address, name, connected_at, last_seen, is_active)
                     VALUES ($1, $2, NOW(), NOW(), TRUE)
                     ON CONFLICT (address) 
                     DO UPDATE SET 
                         name = COALESCE(EXCLUDED.name, ble_connections.name),
                         connected_at = NOW(),
                         last_seen = NOW(),
                         is_active = TRUE`,
                    [address, deviceName]
                );
                console.log(`[BLE] Persisted connection for device ${address}`);
            } catch (dbError) {
                console.error(`[BLE] Failed to persist connection to database:`, dbError);
                // Don't fail the request if DB write fails, connection is still active
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
            headers: { 'Content-Type': 'application/json' },
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

    try {
        // Get all active connections from database
        const result = await pool.query(
            `SELECT address, name FROM ble_connections WHERE is_active = TRUE`
        );

        if (result.rows.length === 0) {
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
                    headers: { 'Content-Type': 'application/json' },
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
    } catch (error) {
        console.error('[BLE] Error during connection restoration:', error);
    }
}

export default router;