/**
 * Webhook Notification Provider
 *
 * Sends HTTP requests to user-defined webhook URLs when automation rules trigger.
 * Includes SSRF protection: HTTPS-only, private IP blocking, hostname blocklist,
 * request timeouts, no redirects, and optional auth headers.
 */

import { NotificationProvider } from '../NotificationProvider.js';
import dns from 'dns/promises';

// Hostnames that must never be called
const BLOCKED_HOSTNAMES = [
    'localhost',
    'postgres',
    'influxdb',
    'redis',
    'nginx',
    'webserver',
    'grafana',
    'mosquitto',
    'mqtt',
];

// Private / reserved IP ranges (RFC 1918, loopback, link-local, etc.)
const PRIVATE_IP_PATTERNS = [
    /^127\./,                       // 127.0.0.0/8   loopback
    /^10\./,                        // 10.0.0.0/8    private
    /^172\.(1[6-9]|2\d|3[01])\./,   // 172.16.0.0/12 private
    /^192\.168\./,                  // 192.168.0.0/16 private
    /^169\.254\./,                  // 169.254.0.0/16 link-local
    /^0\./,                         // 0.0.0.0/8
    /^100\.(6[4-9]|[7-9]\d|1[0-2]\d)\./,  // 100.64.0.0/10 CGNAT
    /^::1$/,                        // IPv6 loopback
    /^fc/i,                         // IPv6 unique-local
    /^fd/i,                         // IPv6 unique-local
    /^fe80/i,                       // IPv6 link-local
];

const MAX_PAYLOAD_BYTES = 10 * 1024; // 10 KB
const REQUEST_TIMEOUT_MS = 10000;    // 10 seconds

/**
 * Check whether an IP address falls into a private/reserved range.
 * @param {string} ip
 * @returns {boolean}
 */
function isPrivateIP(ip) {
    return PRIVATE_IP_PATTERNS.some(pattern => pattern.test(ip));
}

/**
 * Check whether a hostname is blocked (exact match or suffix match for *.local etc.)
 * @param {string} hostname
 * @returns {boolean}
 */
function isBlockedHostname(hostname) {
    const lower = hostname.toLowerCase();

    if (BLOCKED_HOSTNAMES.includes(lower)) {
        return true;
    }

    // Block *.local and *.internal suffixes
    if (lower.endsWith('.local') || lower.endsWith('.internal')) {
        return true;
    }

    return false;
}

export class WebhookProvider extends NotificationProvider {
    constructor() {
        super('webhook');
    }

    /**
     * Send a webhook request.
     *
     * Expected payload shape (assembled by NotificationService / RuleEngine):
     *   target   – the webhook URL (https://...)
     *   title    – human-readable title (used in auto-payload)
     *   message  – human-readable message (used in auto-payload)
     *   metadata.httpMethod     – 'POST' | 'GET'  (default POST)
     *   metadata.customPayload  – user-defined JSON string or null
     *   metadata.authHeader     – e.g. "Bearer abc123" or "X-API-Key: abc"
     *   metadata.sensorData     – { sensor_box, sensor_type, value, timestamp }
     *   metadata.ruleId         – UUID
     *
     * @param {Object} payload
     * @returns {Promise<import('../NotificationProvider.js').NotificationResult>}
     */
    async send(payload) {
        const {
            target,
            title,
            message,
            metadata = {}
        } = payload;

        // ── 1. Validate URL format ──────────────────────────────────────
        let url;
        try {
            url = new URL(target);
        } catch {
            return { success: false, error: `Invalid webhook URL: ${target}` };
        }

        // ── 2. HTTPS only ───────────────────────────────────────────────
        if (url.protocol !== 'https:') {
            return {
                success: false,
                error: 'Only HTTPS webhook URLs are allowed for security'
            };
        }

        // ── 3. Blocked hostname check ───────────────────────────────────
        if (isBlockedHostname(url.hostname)) {
            return {
                success: false,
                error: `Webhook target hostname '${url.hostname}' is blocked`
            };
        }

        // ── 4. DNS resolve → private IP check ───────────────────────────
        try {
            let addresses = [];
            try {
                addresses = addresses.concat(await dns.resolve4(url.hostname));
            } catch { /* may not have A record */ }
            try {
                addresses = addresses.concat(await dns.resolve6(url.hostname));
            } catch { /* may not have AAAA record */ }

            if (addresses.length === 0) {
                return {
                    success: false,
                    error: `Could not resolve hostname: ${url.hostname}`
                };
            }

            const privateIP = addresses.find(isPrivateIP);
            if (privateIP) {
                return {
                    success: false,
                    error: `Webhook target resolves to private/internal IP (${privateIP}) — blocked for security`
                };
            }
        } catch (dnsError) {
            return {
                success: false,
                error: `DNS resolution failed for ${url.hostname}: ${dnsError.message}`
            };
        }

        // ── 5. Build request ────────────────────────────────────────────
        const httpMethod = (metadata.httpMethod || 'POST').toUpperCase();
        if (!['GET', 'POST', 'PUT', 'PATCH'].includes(httpMethod)) {
            return { success: false, error: `Unsupported HTTP method: ${httpMethod}` };
        }

        const headers = {
            'Content-Type': 'application/json',
            'User-Agent': 'RoomSense-Webhook/1.0',
        };

        // Auth header (e.g. "Bearer token123" or full "X-API-Key: value")
        if (metadata.authHeader) {
            const authStr = String(metadata.authHeader).trim();
            if (authStr.includes(':')) {
                // Custom header format "Header-Name: value"
                const colonIdx = authStr.indexOf(':');
                const headerName = authStr.substring(0, colonIdx).trim();
                const headerValue = authStr.substring(colonIdx + 1).trim();
                if (headerName && headerValue) {
                    headers[headerName] = headerValue;
                }
            } else {
                // Treat as Bearer token
                headers['Authorization'] = `Bearer ${authStr}`;
            }
        }

        // Build body
        let body = undefined;
        if (httpMethod !== 'GET') {
            if (metadata.customPayload) {
                // User-supplied JSON payload
                body = typeof metadata.customPayload === 'string'
                    ? metadata.customPayload
                    : JSON.stringify(metadata.customPayload);
            } else {
                // Auto-generated payload with sensor data
                body = JSON.stringify({
                    event: 'sensor_alert',
                    rule_id: metadata.ruleId || null,
                    title: title || 'RoomSense Alert',
                    message: message || '',
                    sensor: metadata.sensorData || {},
                    triggered_at: new Date().toISOString(),
                });
            }

            // Enforce payload size limit
            if (body && Buffer.byteLength(body, 'utf8') > MAX_PAYLOAD_BYTES) {
                return {
                    success: false,
                    error: `Webhook payload exceeds maximum size of ${MAX_PAYLOAD_BYTES / 1024}KB`
                };
            }
        }

        // ── 6. Fire request ─────────────────────────────────────────────
        try {
            const fetchOptions = {
                method: httpMethod,
                headers,
                redirect: 'error',  // Block redirects (SSRF bypass prevention)
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            };
            if (body) {
                fetchOptions.body = body;
            }

            const response = await fetch(url.toString(), fetchOptions);

            if (!response.ok) {
                return {
                    success: false,
                    error: `Webhook returned HTTP ${response.status}`,
                    provider: this.name,
                };
            }

            return {
                success: true,
                messageId: null,
                provider: this.name,
            };

        } catch (fetchError) {
            let errorMsg = fetchError.message;
            if (fetchError.name === 'AbortError' || fetchError.name === 'TimeoutError') {
                errorMsg = `Webhook request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`;
            }
            if (errorMsg.includes('redirect')) {
                errorMsg = 'Webhook URL attempted a redirect — blocked for security';
            }

            return {
                success: false,
                error: `Webhook request failed: ${errorMsg}`,
                provider: this.name,
            };
        }
    }

    /**
     * Validate webhook target URL.
     * Must be a valid HTTPS URL with a non-blocked hostname.
     *
     * @param {string} target
     * @returns {boolean}
     */
    validateTarget(target) {
        if (!target || typeof target !== 'string') {
            return false;
        }

        try {
            const url = new URL(target);

            // Must be HTTPS
            if (url.protocol !== 'https:') {
                return false;
            }

            // Must not target a blocked hostname
            if (isBlockedHostname(url.hostname)) {
                return false;
            }

            return true;
        } catch {
            return false;
        }
    }
}

export default WebhookProvider;
