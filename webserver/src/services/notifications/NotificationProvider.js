/**
 * Notification Provider Interface
 *
 * All notification providers must implement this interface.
 * This allows for easy extension with new providers (Email, SMS, etc.)
 */

/**
 * @typedef {Object} NotificationPayload
 * @property {string} target - Provider-specific target (topic, email, phone number)
 * @property {string} title - Notification title
 * @property {string} message - Notification body message
 * @property {string} priority - Priority level (low, default, high, urgent)
 * @property {Object} [metadata] - Additional provider-specific metadata
 */

/**
 * @typedef {Object} NotificationResult
 * @property {boolean} success - Whether the notification was sent successfully
 * @property {string} [messageId] - Provider-specific message identifier
 * @property {string} [error] - Error message if failed
 */

/**
 * Base class for notification providers
 * Subclasses must implement the send() method
 */
export class NotificationProvider {
    constructor(name) {
        if (this.constructor === NotificationProvider) {
            throw new Error('NotificationProvider is an abstract class');
        }
        this.name = name;
    }

    /**
     * Send a notification
     * @param {NotificationPayload} payload - The notification payload
     * @returns {Promise<NotificationResult>} - Result of the send operation
     */
    async send(payload) {
        throw new Error('Method send() must be implemented');
    }

    /**
     * Validate the target for this provider
     * @param {string} target - The notification target
     * @returns {boolean} - Whether the target is valid
     */
    validateTarget(target) {
        throw new Error('Method validateTarget() must be implemented');
    }

    /**
     * Get provider name
     * @returns {string} - The provider name
     */
    getName() {
        return this.name;
    }
}

export default NotificationProvider;

