/**
 * Ntfy.sh Notification Provider
 *
 * Implements push notifications via ntfy.sh service.
 * Documentation: https://ntfy.sh/docs/
 */

import { NotificationProvider } from '../NotificationProvider.js';

// Map internal priority levels to ntfy priority numbers
const PRIORITY_MAP = {
    'min': 1,
    'low': 2,
    'default': 3,
    'high': 4,
    'urgent': 5,
    'max': 5
};

export class NtfyProvider extends NotificationProvider {
    constructor(options = {}) {
        super('ntfy');

        // Default to public ntfy.sh server, but allow self-hosted
        this.baseUrl = options.baseUrl || process.env.NTFY_BASE_URL || 'https://ntfy.sh';
        this.defaultPriority = options.defaultPriority || 'default';
        this.accessToken = options.accessToken || process.env.NTFY_ACCESS_TOKEN;
    }

    /**
     * Send a notification via ntfy.sh
     * @param {Object} payload - Notification payload
     * @param {string} payload.target - The ntfy topic
     * @param {string} payload.title - Notification title
     * @param {string} payload.message - Notification message body
     * @param {string} [payload.priority] - Priority level
     * @param {Object} [payload.metadata] - Additional metadata
     * @returns {Promise<Object>} - Result of the send operation
     */
    async send(payload) {
        const { target, title, message, priority = this.defaultPriority, metadata = {} } = payload;

        if (!this.validateTarget(target)) {
            return {
                success: false,
                error: 'Invalid ntfy topic. Must be alphanumeric with underscores/hyphens (3-64 chars)'
            };
        }

        const url = `${this.baseUrl}/${encodeURIComponent(target)}`;

        const headers = {
            'Content-Type': 'text/plain',
            'Title': title || 'RoomSense Alert',
            'Priority': String(PRIORITY_MAP[priority] || PRIORITY_MAP['default'])
        };

        // Add optional headers
        if (metadata.tags) {
            headers['Tags'] = Array.isArray(metadata.tags) ? metadata.tags.join(',') : metadata.tags;
        }

        if (metadata.click) {
            headers['Click'] = metadata.click;
        }

        if (metadata.actions) {
            headers['Actions'] = metadata.actions;
        }

        // Add authorization if token is configured
        if (this.accessToken) {
            headers['Authorization'] = `Bearer ${this.accessToken}`;
        }

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers,
                body: message
            });

            if (!response.ok) {
                const errorText = await response.text();
                return {
                    success: false,
                    error: `Ntfy API error (${response.status}): ${errorText}`
                };
            }

            const responseData = await response.json().catch(() => ({}));

            return {
                success: true,
                messageId: responseData.id || null,
                provider: this.name
            };
        } catch (error) {
            return {
                success: false,
                error: `Failed to send ntfy notification: ${error.message}`
            };
        }
    }

    /**
     * Validate ntfy topic name
     * Topics must be alphanumeric with underscores/hyphens, 3-64 characters
     * @param {string} target - The topic to validate
     * @returns {boolean} - Whether the topic is valid
     */
    validateTarget(target) {
        if (!target || typeof target !== 'string') {
            return false;
        }

        // Ntfy topics: alphanumeric, underscore, hyphen, 1-64 chars
        // Being slightly more permissive than official spec
        const topicRegex = /^[a-zA-Z0-9_-]{1,64}$/;
        return topicRegex.test(target);
    }
}

export default NtfyProvider;

