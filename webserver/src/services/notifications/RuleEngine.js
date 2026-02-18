/**
 * Rule Engine
 *
 * Background worker that periodically queries InfluxDB for latest sensor readings
 * and evaluates them against active PostgreSQL notification rules.
 */

import pg from 'pg';
import { influxClient, organisation, bucket } from '../../routes/sensors/influxClient.js';
import notificationService from './NotificationService.js';
import fs from 'fs';

const { Pool } = pg;

// Read password directly from Docker secret file
let dbPassword = process.env.PGPASSWORD;
try {
    const secretPath = '/run/secrets/pgpassword';
    if (fs.existsSync(secretPath)) {
        const secret = fs.readFileSync(secretPath, 'utf8')
            .replace(/\r\n/g, '')
            .replace(/\n/g, '')
            .replace(/\r/g, '');
        if (secret) {
            dbPassword = secret;
        }
    }
} catch (error) {
    // Fall back to process.env.PGPASSWORD
}

const poolOptions = {
    user: process.env.PGUSER || 'postgres',
    password: dbPassword,
    host: process.env.PGHOST || 'postgres',
    port: process.env.PGPORT ? parseInt(process.env.PGPORT) : 5432,
    database: process.env.PGDATABASE || 'user',
};

class RuleEngine {
    constructor() {
        this.pool = null;
        this.intervalId = null;
        this.isRunning = false;
        this.checkIntervalMs = parseInt(process.env.RULE_CHECK_INTERVAL_MS) || 60000; // Default: 1 minute
        this.lastCheckTime = null;
    }

    /**
     * Initialize the rule engine with a database pool
     * @param {pg.Pool} [externalPool] - Optional external pool to use
     */
    initialize(externalPool = null) {
        if (this.pool) {
            console.log('⚠️  RuleEngine already initialized');
            return;
        }

        this.pool = externalPool || new Pool(poolOptions);
        notificationService.initialize();
        console.log('✓ RuleEngine initialized');
    }

    /**
     * Start the background rule evaluation process
     */
    start() {
        if (this.isRunning) {
            console.log('⚠️  RuleEngine is already running');
            return;
        }

        if (!this.pool) {
            console.error('❌ RuleEngine not initialized. Call initialize() first.');
            return;
        }

        this.isRunning = true;
        console.log(`✓ RuleEngine started. Checking rules every ${this.checkIntervalMs / 1000} seconds`);

        // Run immediately on start
        this.evaluateRules().catch(error => {
            console.error('❌ Unhandled error in evaluateRules (initial run):', error);
        });

        // Then run periodically
        this.intervalId = setInterval(() => {
            this.evaluateRules().catch(error => {
                console.error('❌ Unhandled error in evaluateRules (periodic run):', error);
            });
        }, this.checkIntervalMs);
    }

    /**
     * Stop the background rule evaluation process
     */
    stop() {
        if (!this.isRunning) {
            console.log('⚠️  RuleEngine is not running');
            return;
        }

        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }

        this.isRunning = false;
        console.log('✓ RuleEngine stopped');
    }

    /**
     * Get engine status
     * @returns {Object} - Status information
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            checkIntervalMs: this.checkIntervalMs,
            lastCheckTime: this.lastCheckTime,
            initialized: !!this.pool
        };
    }

    /**
     * Fetch all enabled rules from the database
     * @returns {Promise<Array>} - Array of active rules
     */
    async getActiveRules() {
        try {
            const result = await this.pool.query(`
                SELECT 
                    id, user_id, name, sensor_id, sensor_type, condition, threshold,
                    notification_provider, notification_target, notification_priority,
                    notification_title, notification_message, cooldown_seconds,
                    webhook_http_method, webhook_payload, webhook_auth_header,
                    is_enabled, last_triggered_at, trigger_count
                FROM notification_rules
                WHERE is_enabled = true
            `);
            return result.rows;
        } catch (error) {
            console.error('❌ Error fetching active rules:', error.message);
            return [];
        }
    }

    /**
     * Get the latest sensor reading from InfluxDB
     * @param {string} sensorId - The sensor box identifier ('*' for any)
     * @param {string} sensorType - The sensor type to query
     * @returns {Promise<Object|null>} - Latest sensor data or null
     */
    async getLatestSensorReading(sensorId, sensorType) {
        return new Promise((resolve) => {
            const queryClient = influxClient.getQueryApi(organisation);

            // Build the Flux query for the latest reading
            let fluxQuery = `
                from(bucket: "${bucket}")
                    |> range(start: -5m)
                    |> filter(fn: (r) => r["_measurement"] == "sensor_data")
                    |> filter(fn: (r) => r["sensor_type"] == "${this.escapeFluxString(sensorType)}")
            `;

            // Add sensor_box filter if not wildcard
            if (sensorId && sensorId !== '*') {
                fluxQuery += `    |> filter(fn: (r) => r["sensor_box"] == "${this.escapeFluxString(sensorId)}")\n`;
            }

            fluxQuery += `
                    |> filter(fn: (r) => r["_field"] == "value")
                    |> last()
            `;

            let latestReading = null;

            queryClient.queryRows(fluxQuery, {
                next: (row, tableMeta) => {
                    const tableObject = tableMeta.toObject(row);
                    latestReading = {
                        sensor_box: tableObject.sensor_box,
                        sensor_type: tableObject.sensor_type,
                        value: parseFloat(tableObject._value),
                        timestamp: tableObject._time
                    };
                },
                error: (error) => {
                    console.error(`❌ Error querying InfluxDB for ${sensorType}:`, error.message);
                    resolve(null);
                },
                complete: () => {
                    resolve(latestReading);
                }
            });
        });
    }

    /**
     * Escape string for Flux queries
     * @param {string} value - The value to escape
     * @returns {string} - Escaped value
     */
    escapeFluxString(value) {
        if (typeof value !== 'string') return '';
        return value
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r');
    }

    /**
     * Evaluate a condition against sensor data
     * @param {number} sensorValue - The sensor reading value
     * @param {string} condition - The comparison operator
     * @param {number} threshold - The threshold value
     * @returns {boolean} - Whether the condition is met
     */
    evaluateCondition(sensorValue, condition, threshold) {
        const numValue = parseFloat(sensorValue);
        const numThreshold = parseFloat(threshold);

        if (isNaN(numValue) || isNaN(numThreshold)) {
            return false;
        }

        switch (condition) {
            case '>':
                return numValue > numThreshold;
            case '<':
                return numValue < numThreshold;
            case '>=':
                return numValue >= numThreshold;
            case '<=':
                return numValue <= numThreshold;
            case '==':
                return numValue === numThreshold;
            case '!=':
                return numValue !== numThreshold;
            default:
                console.warn(`⚠️  Unknown condition operator: ${condition}`);
                return false;
        }
    }

    /**
     * Check if a rule is within its cooldown period
     * @param {Object} rule - The notification rule
     * @returns {boolean} - True if still in cooldown
     */
    isInCooldown(rule) {
        if (!rule.last_triggered_at) {
            return false;
        }

        const lastTriggered = new Date(rule.last_triggered_at).getTime();
        const cooldownMs = (rule.cooldown_seconds || 300) * 1000;
        const now = Date.now();

        return (now - lastTriggered) < cooldownMs;
    }

    /**
     * Update rule metadata after triggering
     * @param {string} ruleId - The rule ID
     */
    async updateRuleTriggerMetadata(ruleId) {
        try {
            await this.pool.query(`
                UPDATE notification_rules
                SET last_triggered_at = NOW(), trigger_count = trigger_count + 1
                WHERE id = $1
            `, [ruleId]);
        } catch (error) {
            console.error(`❌ Error updating rule metadata for ${ruleId}:`, error.message);
        }
    }

    /**
     * Log notification to history table
     * @param {Object} rule - The rule that triggered
     * @param {Object} sensorData - The sensor data
     * @param {string} status - Notification status (sent, failed, cooldown_skipped)
     * @param {string} [errorMessage] - Error message if failed
     */
    async logNotificationHistory(rule, sensorData, status, errorMessage = null) {
        try {
            await this.pool.query(`
                INSERT INTO notification_history 
                (rule_id, user_id, sensor_id, sensor_type, sensor_value, threshold, condition,
                 notification_provider, notification_target, notification_status, error_message)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            `, [
                rule.id,
                rule.user_id,
                sensorData.sensor_box || rule.sensor_id,
                rule.sensor_type,
                sensorData.value,
                rule.threshold,
                rule.condition,
                rule.notification_provider,
                rule.notification_target,
                status,
                errorMessage
            ]);
        } catch (error) {
            console.error('❌ Error logging notification history:', error.message);
        }
    }

    /**
     * Main evaluation loop - checks all active rules against latest sensor data
     */
    async evaluateRules() {
        this.lastCheckTime = new Date().toISOString();

        try {
            const rules = await this.getActiveRules();

            if (rules.length === 0) {
                return;
            }

            console.log(`🔍 Evaluating ${rules.length} active notification rules...`);

            for (const rule of rules) {
                try {
                    // Get the latest sensor reading for this rule
                    const sensorData = await this.getLatestSensorReading(
                        rule.sensor_id,
                        rule.sensor_type
                    );

                    if (!sensorData) {
                        // No data available for this sensor/type combination
                        continue;
                    }

                    // Evaluate the condition
                    const conditionMet = this.evaluateCondition(
                        sensorData.value,
                        rule.condition,
                        rule.threshold
                    );

                    if (!conditionMet) {
                        continue;
                    }

                    // Check cooldown
                    if (this.isInCooldown(rule)) {
                        console.log(`⏸️  Rule "${rule.name}" triggered but in cooldown period`);
                        await this.logNotificationHistory(rule, sensorData, 'cooldown_skipped');
                        continue;
                    }

                    // Build notification payload
                    const payload = notificationService.buildNotificationPayload(rule, sensorData);

                    // Inject webhook-specific metadata
                    if (rule.notification_provider === 'webhook') {
                        payload.metadata = payload.metadata || {};
                        payload.metadata.httpMethod = rule.webhook_http_method || 'POST';
                        payload.metadata.customPayload = rule.webhook_payload || null;
                        payload.metadata.authHeader = rule.webhook_auth_header || null;
                        payload.metadata.sensorData = sensorData;
                    }

                    // Send notification
                    console.log(`🔔 Rule "${rule.name}" triggered: ${rule.sensor_type} ${sensorData.value} ${rule.condition} ${rule.threshold}`);

                    const result = await notificationService.send(rule.notification_provider, payload);

                    if (result.success) {
                        console.log(`✅ Notification sent via ${rule.notification_provider} to ${rule.notification_target}`);
                        await this.updateRuleTriggerMetadata(rule.id);
                        await this.logNotificationHistory(rule, sensorData, 'sent');
                    } else {
                        console.error(`❌ Failed to send notification: ${result.error}`);
                        await this.logNotificationHistory(rule, sensorData, 'failed', result.error);
                    }

                } catch (ruleError) {
                    console.error(`❌ Error processing rule ${rule.id}:`, ruleError.message);
                }
            }

        } catch (error) {
            console.error('❌ Error in rule evaluation loop:', error.message);
        }
    }

    /**
     * Manually trigger rule evaluation (useful for testing)
     * @returns {Promise<void>}
     */
    async forceEvaluation() {
        console.log('🔄 Force evaluation triggered');
        await this.evaluateRules();
    }

    /**
     * Test a specific rule without sending notification
     * @param {Object} rule - The rule to test
     * @returns {Promise<Object>} - Test result
     */
    async testRule(rule) {
        try {
            const sensorData = await this.getLatestSensorReading(
                rule.sensor_id,
                rule.sensor_type
            );

            if (!sensorData) {
                return {
                    success: false,
                    error: `No sensor data available for ${rule.sensor_type} (sensor: ${rule.sensor_id})`
                };
            }

            const conditionMet = this.evaluateCondition(
                sensorData.value,
                rule.condition,
                rule.threshold
            );

            const inCooldown = rule.last_triggered_at ? this.isInCooldown(rule) : false;

            return {
                success: true,
                sensorData,
                conditionMet,
                inCooldown,
                wouldTrigger: conditionMet && !inCooldown,
                message: conditionMet
                    ? `Condition met: ${sensorData.value} ${rule.condition} ${rule.threshold}`
                    : `Condition not met: ${sensorData.value} ${rule.condition} ${rule.threshold}`
            };

        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }
}

// Singleton instance
const ruleEngine = new RuleEngine();

export { ruleEngine, RuleEngine };
export default ruleEngine;

