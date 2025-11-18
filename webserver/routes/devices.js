import express from 'express';
import { requireLogin } from '../auth/auth.js';

const router = express.Router();

// Dev mode: bypass auth if DEV_BYPASS_AUTH is set
const authMiddleware = process.env.DEV_BYPASS_AUTH === '1' 
    ? (req, res, next) => next()  // Skip auth in dev mode
    : requireLogin;  // Require auth in production

// BLE Gateway API endpoint
const BLE_GATEWAY_URL = process.env.BLE_GATEWAY_URL || 'http://172.17.0.1:8080'; // <-- Added http://
const SCAN_TIMEOUT_MS = 12000; // 12 seconds (Python scan is 8s + 2s buffer)
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
 */
router.post('/connect/:address', authMiddleware, async (req, res) => {
    const { address } = req.params;
    if (!address) {
        return res.status(400).json({ error: 'Missing device address' });
    }
    
    await proxyToGateway(
        res,
        `${BLE_GATEWAY_URL}/connect/${encodeURIComponent(address)}`,
        { method: 'POST' }
    );
});

/**
 * POST /api/devices/disconnect/:address
 * Requests the gateway to disconnect from a specific device.
 */
router.post('/disconnect/:address', authMiddleware, async (req, res) => {
    const { address } = req.params;
    if (!address) {
        return res.status(400).json({ error: 'Missing device address' });
    }

    await proxyToGateway(
        res,
        `${BLE_GATEWAY_URL}/disconnect/${encodeURIComponent(address)}`,
        { method: 'POST' }
    );
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

export default router;