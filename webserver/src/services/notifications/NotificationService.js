/**
 * Notification Service
 *
 * Central service for managing notification providers and sending notifications.
 * Follows the provider pattern to support multiple notification channels.
 */

import { NtfyProvider } from './providers/NtfyProvider.js';
import { WebhookProvider } from './providers/WebhookProvider.js';

class NotificationService {
    constructor() {
        /** @type {Map<string, import('./NotificationProvider.js').NotificationProvider>} */
        this.providers = new Map();
        this.initialized = false;
    }

    /**
     * Initialize the notification service with default providers
     */
    initialize() {
        if (this.initialized) {
            return;
        }

        // Register default providers
        this.registerProvider(new NtfyProvider());
        this.registerProvider(new WebhookProvider());

        // Future providers can be added here:
        // this.registerProvider(new EmailProvider());
        // this.registerProvider(new SMSProvider());

        this.initialized = true;
        console.log('✓ NotificationService initialized with providers:', this.getProviderNames().join(', '));
    }

    /**
     * Register a notification provider
     * @param {import('./NotificationProvider.js').NotificationProvider} provider - The provider instance
     */
    registerProvider(provider) {
        if (!provider || typeof provider.send !== 'function') {
            throw new Error('Invalid notification provider: must implement send() method');
        }

        this.providers.set(provider.getName(), provider);
        console.log(`✓ Registered notification provider: ${provider.getName()}`);
    }

    /**
     * Unregister a notification provider
     * @param {string} providerName - The provider name to remove
     * @returns {boolean} - Whether the provider was removed
     */
    unregisterProvider(providerName) {
        return this.providers.delete(providerName);
    }

    /**
     * Get a provider by name
     * @param {string} providerName - The provider name
     * @returns {import('./NotificationProvider.js').NotificationProvider|undefined}
     */
    getProvider(providerName) {
        return this.providers.get(providerName);
    }

    /**
     * Get all registered provider names
     * @returns {string[]}
     */
    getProviderNames() {
        return Array.from(this.providers.keys());
    }

    /**
     * Check if a provider is registered
     * @param {string} providerName - The provider name
     * @returns {boolean}
     */
    hasProvider(providerName) {
        return this.providers.has(providerName);
    }

    /**
     * Send a notification using the specified provider
     * @param {string} providerName - The provider to use (e.g., 'ntfy', 'email')
     * @param {Object} payload - The notification payload
     * @param {string} payload.target - Provider-specific target
     * @param {string} payload.title - Notification title
     * @param {string} payload.message - Notification message
     * @param {string} [payload.priority] - Priority level
     * @param {Object} [payload.metadata] - Additional metadata
     * @returns {Promise<Object>} - Result of the send operation
     */
    async send(providerName, payload) {
        const provider = this.providers.get(providerName);

        if (!provider) {
            return {
                success: false,
                error: `Unknown notification provider: ${providerName}. Available: ${this.getProviderNames().join(', ')}`
            };
        }

        try {
            const result = await provider.send(payload);
            return result;
        } catch (error) {
            console.error(`NotificationService.send error (${providerName}):`, error);
            return {
                success: false,
                error: `Provider error: ${error.message}`
            };
        }
    }

    /**
     * Validate a target for a specific provider
     * @param {string} providerName - The provider name
     * @param {string} target - The target to validate
     * @returns {boolean} - Whether the target is valid
     */
    validateTarget(providerName, target) {
        const provider = this.providers.get(providerName);

        if (!provider) {
            return false;
        }

        return provider.validateTarget(target);
    }

    /**
     * Build a notification message from a rule and sensor data
     * @param {Object} rule - The notification rule
     * @param {Object} sensorData - The sensor data that triggered the rule
     * @returns {Object} - The formatted notification payload
     */
    buildNotificationPayload(rule, sensorData) {
        const conditionText = {
            '>': 'exceeded',
            '<': 'dropped below',
            '>=': 'reached or exceeded',
            '<=': 'reached or dropped below',
            '==': 'equals',
            '!=': 'is not equal to'
        };

        const action = conditionText[rule.condition] || 'triggered';

        // Use custom title or generate default
        const title = rule.notification_title
            ? this.interpolateTemplate(rule.notification_title, rule, sensorData)
            : `🚨 ${rule.name || 'Sensor Alert'}`;

        // Use custom message or generate default
        const message = rule.notification_message
            ? this.interpolateTemplate(rule.notification_message, rule, sensorData)
            : `${rule.sensor_type} ${action} threshold of ${rule.threshold}.\n` +
            `Current value: ${sensorData.value}\n` +
            `Sensor: ${sensorData.sensor_box || rule.sensor_id}\n` +
            `Time: ${new Date(sensorData.timestamp || Date.now()).toLocaleString()}`;

        return {
            target: rule.notification_target,
            title,
            message,
            priority: rule.notification_priority || 'default',
            metadata: {
                tags: this.getSensorTypeTags(rule.sensor_type),
                ruleId: rule.id,
                sensorId: sensorData.sensor_box || rule.sensor_id
            }
        };
    }

    /**
     * Interpolate template variables in notification title/message
     * Supported variables: {{sensor_type}}, {{sensor_id}}, {{value}}, {{threshold}}, {{condition}}, {{name}}
     * @param {string} template - The template string
     * @param {Object} rule - The rule object
     * @param {Object} sensorData - The sensor data
     * @returns {string} - The interpolated string
     */
    interpolateTemplate(template, rule, sensorData) {
        return template
            .replace(/\{\{sensor_type\}\}/g, rule.sensor_type || '')
            .replace(/\{\{sensor_id\}\}/g, sensorData.sensor_box || rule.sensor_id || '')
            .replace(/\{\{value\}\}/g, String(sensorData.value || ''))
            .replace(/\{\{threshold\}\}/g, String(rule.threshold || ''))
            .replace(/\{\{condition\}\}/g, rule.condition || '')
            .replace(/\{\{name\}\}/g, rule.name || 'Alert');
    }

    /**
     * Get emoji tags based on sensor type for ntfy
     * @param {string} sensorType - The sensor type
     * @returns {string[]} - Array of emoji tags
     */
    getSensorTypeTags(sensorType) {
        const tagMap = {
            'temperature': ['thermometer', 'warning'],
            'humidity': ['droplet', 'warning'],
            'pressure': ['cyclone', 'warning'],
            'light': ['bulb', 'warning'],
            'motion': ['running', 'warning'],
            'co2': ['cloud', 'warning'],
            'battery': ['battery', 'warning']
        };

        return tagMap[sensorType?.toLowerCase()] || ['bell', 'warning'];
    }
}

// Singleton instance
const notificationService = new NotificationService();

export { notificationService, NotificationService };
export default notificationService;

