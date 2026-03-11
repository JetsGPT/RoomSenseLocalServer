/**
 * Outside Server Notification Provider
 *
 * Relays notifications through the RoomSense Outside Server's relay endpoint.
 * Instead of sending notifications directly (like NtfyProvider), this provider
 * forwards the payload to the outside server which handles the actual delivery.
 *
 * Configuration via environment variables:
 *   OUTSIDE_SERVER_URL        - Base URL of the outside server (e.g. https://your-server.com)
 *   OUTSIDE_SERVER_RELAY_SECRET - Shared secret for relay authentication (X-Relay-Secret)
 *   OUTSIDE_SERVER_ID         - Server ID for identity-token based auth (X-Server-ID)
 *   OUTSIDE_SERVER_IDENTITY_TOKEN - Identity token for auth (X-Identity-Token)
 */

import { NotificationProvider } from '../NotificationProvider.js';

const REQUEST_TIMEOUT_MS = 15000; // 15 seconds (slightly longer since it's a relay)

export class OutsideServerProvider extends NotificationProvider {
    constructor(options = {}) {
        super('outside_server');

        this.baseUrl = options.baseUrl || process.env.OUTSIDE_SERVER_URL || 'proxy.roomsense.info:8443';
        this.relaySecret = options.relaySecret || process.env.OUTSIDE_SERVER_RELAY_SECRET || '';
        this.serverId = options.serverId || process.env.OUTSIDE_SERVER_ID || '';
        this.identityToken = options.identityToken || process.env.OUTSIDE_SERVER_IDENTITY_TOKEN || '';
    }

    /**
     * Send a notification by relaying it through the outside server.
     *
     * @param {Object} payload - Notification payload
     * @param {string} payload.target - The notification target (e.g. ntfy topic, email address)
     * @param {string} payload.title - Notification title
     * @param {string} payload.message - Notification message body
     * @param {string} [payload.priority] - Priority level (min, low, default, high, urgent)
     * @param {Object} [payload.metadata] - Additional metadata
     * @param {string} [payload.metadata.remoteProvider] - Provider to use on the outside server (default: 'ntfy')
     * @returns {Promise<Object>} - Result of the send operation
     */
    async send(payload) {
        const { target, title, message, priority = 'default', metadata = {} } = payload;

        // Validate configuration
        if (!this.baseUrl) {
            return {
                success: false,
                error: 'Outside server URL not configured. Set OUTSIDE_SERVER_URL environment variable.'
            };
        }

        if (!this.relaySecret && !(this.serverId && this.identityToken)) {
            return {
                success: false,
                error: 'Outside server authentication not configured. Set OUTSIDE_SERVER_RELAY_SECRET or both OUTSIDE_SERVER_ID and OUTSIDE_SERVER_IDENTITY_TOKEN.'
            };
        }

        if (!this.validateTarget(target)) {
            return {
                success: false,
                error: 'Invalid notification target: must be a non-empty string'
            };
        }

        const relayUrl = `${this.baseUrl.replace(/\/+$/, '')}/api/v1/relay/send`;

        // Build the relay request body matching NotificationRelayRequest on the outside server
        const relayBody = {
            target: target,
            title: title || 'RoomSense Alert',
            message: message || '',
            priority: priority || 'default',
            provider: metadata.remoteProvider || 'ntfy',
            tags: Array.isArray(metadata.tags) ? metadata.tags : (metadata.tags ? [metadata.tags] : undefined),
            click_url: metadata.click || undefined,
            extra: metadata.extra || undefined
        };

        // Build auth headers
        const headers = {
            'Content-Type': 'application/json'
        };

        if (this.relaySecret) {
            headers['X-Relay-Secret'] = this.relaySecret;
        }
        if (this.serverId) {
            headers['X-Server-ID'] = this.serverId;
        }
        if (this.identityToken) {
            headers['X-Identity-Token'] = this.identityToken;
        }

        try {
            const response = await fetch(relayUrl, {
                method: 'POST',
                headers,
                body: JSON.stringify(relayBody),
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
            });

            if (!response.ok) {
                let errorDetail;
                try {
                    const errorData = await response.json();
                    errorDetail = errorData.detail?.message || errorData.detail || JSON.stringify(errorData);
                } catch {
                    errorDetail = await response.text();
                }
                return {
                    success: false,
                    error: `Outside server relay failed (HTTP ${response.status}): ${errorDetail}`
                };
            }

            const responseData = await response.json().catch(() => ({}));

            return {
                success: true,
                messageId: responseData.status_code ? String(responseData.status_code) : null,
                provider: this.name
            };
        } catch (error) {
            let errorMsg = error.message;
            if (error.name === 'AbortError' || error.name === 'TimeoutError') {
                errorMsg = `Outside server relay request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`;
            }

            return {
                success: false,
                error: `Failed to relay notification through outside server: ${errorMsg}`
            };
        }
    }

    /**
     * Validate the notification target.
     * Since the outside server handles final validation for the downstream provider,
     * we just check that it's a non-empty string.
     *
     * @param {string} target - The notification target
     * @returns {boolean} - Whether the target is valid
     */
    validateTarget(target) {
        return typeof target === 'string' && target.trim().length > 0;
    }
}

export default OutsideServerProvider;
