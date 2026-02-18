/**
 * Notification Rules Router
 *
 * CRUD API endpoints for managing notification rules.
 * Protected by authentication, rate limiting, and CSRF protection.
 */

import express from 'express';
import { requireLogin } from '../auth/auth.js';
import ruleEngine from '../services/notifications/RuleEngine.js';
import notificationService from '../services/notifications/NotificationService.js';

const router = express.Router();

// Valid conditions for rules
const VALID_CONDITIONS = ['>', '<', '>=', '<=', '==', '!='];
const VALID_PRIORITIES = ['min', 'low', 'default', 'high', 'urgent', 'max'];
const VALID_HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH'];
const MAX_WEBHOOK_PAYLOAD_BYTES = 10240; // 10 KB

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Validate rule input data
 * @param {Object} data - The rule data to validate
 * @param {boolean} isUpdate - Whether this is an update (allows partial data)
 * @returns {Object} - { valid: boolean, errors: string[] }
 */
function validateRuleInput(data, isUpdate = false) {
    const errors = [];

    // Required fields for creation
    if (!isUpdate) {
        if (!data.name || typeof data.name !== 'string' || data.name.trim().length === 0) {
            errors.push('name is required and must be a non-empty string');
        }
        if (!data.sensor_id || typeof data.sensor_id !== 'string') {
            errors.push('sensor_id is required and must be a string');
        }
        if (!data.sensor_type || typeof data.sensor_type !== 'string') {
            errors.push('sensor_type is required and must be a string');
        }
        if (!data.condition) {
            errors.push('condition is required');
        }
        if (data.threshold === undefined || data.threshold === null) {
            errors.push('threshold is required');
        }
        if (!data.notification_target || typeof data.notification_target !== 'string') {
            errors.push('notification_target is required and must be a string');
        }
    }

    // Validate condition if provided
    if (data.condition !== undefined && !VALID_CONDITIONS.includes(data.condition)) {
        errors.push(`condition must be one of: ${VALID_CONDITIONS.join(', ')}`);
    }

    // Validate threshold if provided
    if (data.threshold !== undefined && data.threshold !== null) {
        const threshold = parseFloat(data.threshold);
        if (isNaN(threshold)) {
            errors.push('threshold must be a valid number');
        }
    }

    // Validate priority if provided
    if (data.notification_priority !== undefined &&
        !VALID_PRIORITIES.includes(data.notification_priority)) {
        errors.push(`notification_priority must be one of: ${VALID_PRIORITIES.join(', ')}`);
    }

    // Validate cooldown_seconds if provided
    if (data.cooldown_seconds !== undefined) {
        const cooldown = parseInt(data.cooldown_seconds);
        if (isNaN(cooldown) || cooldown < 0 || cooldown > 86400) {
            errors.push('cooldown_seconds must be a number between 0 and 86400 (24 hours)');
        }
    }

    // Validate notification_provider if provided
    if (data.notification_provider !== undefined) {
        if (!notificationService.hasProvider(data.notification_provider)) {
            const available = notificationService.getProviderNames().join(', ');
            errors.push(`notification_provider must be one of: ${available}`);
        }
    }

    // Validate notification_target format based on provider
    if (data.notification_target !== undefined && data.notification_provider !== undefined) {
        const provider = notificationService.getProvider(data.notification_provider);
        if (provider && !provider.validateTarget(data.notification_target)) {
            errors.push(`Invalid notification_target format for provider '${data.notification_provider}'`);
        }
    }

    // Webhook-specific validations
    if (data.webhook_http_method !== undefined) {
        if (!VALID_HTTP_METHODS.includes(data.webhook_http_method.toUpperCase())) {
            errors.push(`webhook_http_method must be one of: ${VALID_HTTP_METHODS.join(', ')}`);
        }
    }
    if (data.webhook_payload !== undefined && data.webhook_payload !== null) {
        try {
            const payloadStr = typeof data.webhook_payload === 'string'
                ? data.webhook_payload
                : JSON.stringify(data.webhook_payload);
            if (Buffer.byteLength(payloadStr, 'utf8') > MAX_WEBHOOK_PAYLOAD_BYTES) {
                errors.push(`webhook_payload must be less than ${MAX_WEBHOOK_PAYLOAD_BYTES / 1024}KB`);
            }
        } catch {
            errors.push('webhook_payload must be valid JSON');
        }
    }
    if (data.webhook_auth_header !== undefined && data.webhook_auth_header !== null) {
        if (typeof data.webhook_auth_header !== 'string' || data.webhook_auth_header.length > 500) {
            errors.push('webhook_auth_header must be a string of 500 characters or less');
        }
    }

    // Validate string lengths
    if (data.name && data.name.length > 255) {
        errors.push('name must be 255 characters or less');
    }
    if (data.sensor_id && data.sensor_id.length > 255) {
        errors.push('sensor_id must be 255 characters or less');
    }
    if (data.sensor_type && data.sensor_type.length > 100) {
        errors.push('sensor_type must be 100 characters or less');
    }
    if (data.notification_target && data.notification_target.length > 255) {
        errors.push('notification_target must be 255 characters or less');
    }
    if (data.notification_title && data.notification_title.length > 255) {
        errors.push('notification_title must be 255 characters or less');
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Sanitize rule data for database insertion
 * @param {Object} data - The raw input data
 * @returns {Object} - Sanitized data
 */
function sanitizeRuleData(data) {
    const sanitized = {};

    if (data.name !== undefined) {
        sanitized.name = String(data.name).trim().substring(0, 255);
    }
    if (data.sensor_id !== undefined) {
        sanitized.sensor_id = String(data.sensor_id).trim().substring(0, 255);
    }
    if (data.sensor_type !== undefined) {
        sanitized.sensor_type = String(data.sensor_type).trim().toLowerCase().substring(0, 100);
    }
    if (data.condition !== undefined) {
        sanitized.condition = String(data.condition).trim();
    }
    if (data.threshold !== undefined) {
        sanitized.threshold = parseFloat(data.threshold);
    }
    if (data.notification_provider !== undefined) {
        sanitized.notification_provider = String(data.notification_provider).trim().toLowerCase();
    }
    if (data.notification_target !== undefined) {
        sanitized.notification_target = String(data.notification_target).trim().substring(0, 255);
    }
    if (data.notification_priority !== undefined) {
        sanitized.notification_priority = String(data.notification_priority).trim().toLowerCase();
    }
    if (data.notification_title !== undefined) {
        sanitized.notification_title = data.notification_title
            ? String(data.notification_title).trim().substring(0, 255)
            : null;
    }
    if (data.notification_message !== undefined) {
        sanitized.notification_message = data.notification_message
            ? String(data.notification_message).trim()
            : null;
    }
    if (data.cooldown_seconds !== undefined) {
        sanitized.cooldown_seconds = parseInt(data.cooldown_seconds);
    }
    if (data.is_enabled !== undefined) {
        sanitized.is_enabled = Boolean(data.is_enabled);
    }
    // Webhook-specific fields
    if (data.webhook_http_method !== undefined) {
        sanitized.webhook_http_method = String(data.webhook_http_method).trim().toUpperCase();
    }
    if (data.webhook_payload !== undefined) {
        sanitized.webhook_payload = data.webhook_payload === null
            ? null
            : (typeof data.webhook_payload === 'string'
                ? JSON.parse(data.webhook_payload)
                : data.webhook_payload);
    }
    if (data.webhook_auth_header !== undefined) {
        sanitized.webhook_auth_header = data.webhook_auth_header
            ? String(data.webhook_auth_header).trim().substring(0, 500)
            : null;
    }

    return sanitized;
}

// ============================================================================
// API Routes
// ============================================================================

/**
 * GET /api/notifications/rules
 * Get all notification rules for the current user
 */
router.get('/rules', requireLogin, async (req, res) => {
    try {
        const pool = req.app.locals.pool;
        const userId = req.session.user.id;

        const result = await pool.query(`
            SELECT 
                id, name, sensor_id, sensor_type, condition, threshold,
                notification_provider, notification_target, notification_priority,
                notification_title, notification_message, cooldown_seconds,
                webhook_http_method, webhook_payload, webhook_auth_header,
                is_enabled, last_triggered_at, trigger_count, created_at, updated_at
            FROM notification_rules
            WHERE user_id = $1
            ORDER BY created_at DESC
        `, [userId]);

        res.status(200).json({
            rules: result.rows,
            count: result.rows.length
        });

    } catch (error) {
        console.error('Error fetching notification rules:', error);
        res.status(500).json({ error: 'Failed to fetch notification rules' });
    }
});

/**
 * GET /api/notifications/rules/:id
 * Get a specific notification rule
 */
router.get('/rules/:id', requireLogin, async (req, res) => {
    try {
        const pool = req.app.locals.pool;
        const userId = req.session.user.id;
        const ruleId = req.params.id;

        // Validate UUID format
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(ruleId)) {
            return res.status(400).json({ error: 'Invalid rule ID format' });
        }

        const result = await pool.query(`
            SELECT 
                id, name, sensor_id, sensor_type, condition, threshold,
                notification_provider, notification_target, notification_priority,
                notification_title, notification_message, cooldown_seconds,
                webhook_http_method, webhook_payload, webhook_auth_header,
                is_enabled, last_triggered_at, trigger_count, created_at, updated_at
            FROM notification_rules
            WHERE id = $1 AND user_id = $2
        `, [ruleId, userId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Rule not found' });
        }

        res.status(200).json(result.rows[0]);

    } catch (error) {
        console.error('Error fetching notification rule:', error);
        res.status(500).json({ error: 'Failed to fetch notification rule' });
    }
});

/**
 * POST /api/notifications/rules
 * Create a new notification rule
 */
router.post('/rules', requireLogin, async (req, res) => {
    try {
        const pool = req.app.locals.pool;
        const userId = req.session.user.id;

        // Validate input
        const validation = validateRuleInput(req.body, false);
        if (!validation.valid) {
            return res.status(400).json({
                error: 'Validation failed',
                details: validation.errors
            });
        }

        // Sanitize input
        const data = sanitizeRuleData(req.body);

        // Set default provider if not specified
        if (!data.notification_provider) {
            data.notification_provider = 'ntfy';
        }

        // Validate target format for the provider
        const provider = notificationService.getProvider(data.notification_provider);
        if (provider && !provider.validateTarget(data.notification_target)) {
            return res.status(400).json({
                error: 'Invalid notification_target format',
                details: [`Target '${data.notification_target}' is not valid for provider '${data.notification_provider}'`]
            });
        }

        const result = await pool.query(`
            INSERT INTO notification_rules 
            (user_id, name, sensor_id, sensor_type, condition, threshold,
             notification_provider, notification_target, notification_priority,
             notification_title, notification_message, cooldown_seconds,
             webhook_http_method, webhook_payload, webhook_auth_header, is_enabled)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
            RETURNING 
                id, name, sensor_id, sensor_type, condition, threshold,
                notification_provider, notification_target, notification_priority,
                notification_title, notification_message, cooldown_seconds,
                webhook_http_method, webhook_payload, webhook_auth_header,
                is_enabled, last_triggered_at, trigger_count, created_at, updated_at
        `, [
            userId,
            data.name,
            data.sensor_id,
            data.sensor_type,
            data.condition,
            data.threshold,
            data.notification_provider,
            data.notification_target,
            data.notification_priority || 'default',
            data.notification_title || null,
            data.notification_message || null,
            data.cooldown_seconds !== undefined ? data.cooldown_seconds : 300,
            data.webhook_http_method || 'POST',
            data.webhook_payload || null,
            data.webhook_auth_header || null,
            data.is_enabled !== undefined ? data.is_enabled : true
        ]);

        console.log(`✓ Notification rule created: ${result.rows[0].id} by user ${userId}`);

        res.status(201).json(result.rows[0]);

    } catch (error) {
        console.error('Error creating notification rule:', error);
        res.status(500).json({ error: 'Failed to create notification rule' });
    }
});

/**
 * PUT /api/notifications/rules/:id
 * Update an existing notification rule
 */
router.put('/rules/:id', requireLogin, async (req, res) => {
    try {
        const pool = req.app.locals.pool;
        const userId = req.session.user.id;
        const ruleId = req.params.id;

        // Validate UUID format
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(ruleId)) {
            return res.status(400).json({ error: 'Invalid rule ID format' });
        }

        // Check rule exists and belongs to user
        const existingResult = await pool.query(
            'SELECT id FROM notification_rules WHERE id = $1 AND user_id = $2',
            [ruleId, userId]
        );

        if (existingResult.rows.length === 0) {
            return res.status(404).json({ error: 'Rule not found' });
        }

        // Validate input (partial update allowed)
        const validation = validateRuleInput(req.body, true);
        if (!validation.valid) {
            return res.status(400).json({
                error: 'Validation failed',
                details: validation.errors
            });
        }

        // Sanitize input
        const data = sanitizeRuleData(req.body);

        // Build dynamic UPDATE query
        const updates = [];
        const values = [];
        let paramIndex = 1;

        const allowedFields = [
            'name', 'sensor_id', 'sensor_type', 'condition', 'threshold',
            'notification_provider', 'notification_target', 'notification_priority',
            'notification_title', 'notification_message', 'cooldown_seconds',
            'webhook_http_method', 'webhook_payload', 'webhook_auth_header', 'is_enabled'
        ];

        for (const field of allowedFields) {
            if (data[field] !== undefined) {
                updates.push(`${field} = $${paramIndex}`);
                values.push(data[field]);
                paramIndex++;
            }
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No valid fields to update' });
        }

        values.push(ruleId);
        values.push(userId);

        const result = await pool.query(`
            UPDATE notification_rules
            SET ${updates.join(', ')}
            WHERE id = $${paramIndex} AND user_id = $${paramIndex + 1}
            RETURNING 
                id, name, sensor_id, sensor_type, condition, threshold,
                notification_provider, notification_target, notification_priority,
                notification_title, notification_message, cooldown_seconds,
                webhook_http_method, webhook_payload, webhook_auth_header,
                is_enabled, last_triggered_at, trigger_count, created_at, updated_at
        `, values);

        console.log(`✓ Notification rule updated: ${ruleId} by user ${userId}`);

        res.status(200).json(result.rows[0]);

    } catch (error) {
        console.error('Error updating notification rule:', error);
        res.status(500).json({ error: 'Failed to update notification rule' });
    }
});

/**
 * DELETE /api/notifications/rules/:id
 * Delete a notification rule
 */
router.delete('/rules/:id', requireLogin, async (req, res) => {
    try {
        const pool = req.app.locals.pool;
        const userId = req.session.user.id;
        const ruleId = req.params.id;

        // Validate UUID format
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(ruleId)) {
            return res.status(400).json({ error: 'Invalid rule ID format' });
        }

        const result = await pool.query(
            'DELETE FROM notification_rules WHERE id = $1 AND user_id = $2 RETURNING id',
            [ruleId, userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Rule not found' });
        }

        console.log(`✓ Notification rule deleted: ${ruleId} by user ${userId}`);

        res.status(200).json({
            message: 'Rule deleted successfully',
            id: ruleId
        });

    } catch (error) {
        console.error('Error deleting notification rule:', error);
        res.status(500).json({ error: 'Failed to delete notification rule' });
    }
});

/**
 * POST /api/notifications/rules/:id/test
 * Test a notification rule without actually sending (evaluates current sensor data)
 */
router.post('/rules/:id/test', requireLogin, async (req, res) => {
    try {
        const pool = req.app.locals.pool;
        const userId = req.session.user.id;
        const ruleId = req.params.id;

        // Validate UUID format
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(ruleId)) {
            return res.status(400).json({ error: 'Invalid rule ID format' });
        }

        // Get the rule
        const ruleResult = await pool.query(`
            SELECT * FROM notification_rules WHERE id = $1 AND user_id = $2
        `, [ruleId, userId]);

        if (ruleResult.rows.length === 0) {
            return res.status(404).json({ error: 'Rule not found' });
        }

        const rule = ruleResult.rows[0];

        // Test the rule using rule engine
        const testResult = await ruleEngine.testRule(rule);

        res.status(200).json({
            rule: {
                id: rule.id,
                name: rule.name,
                sensor_type: rule.sensor_type,
                sensor_id: rule.sensor_id,
                condition: rule.condition,
                threshold: parseFloat(rule.threshold)
            },
            test: testResult
        });

    } catch (error) {
        console.error('Error testing notification rule:', error);
        res.status(500).json({ error: 'Failed to test notification rule' });
    }
});

/**
 * POST /api/notifications/rules/:id/trigger
 * Manually trigger a notification rule (for testing purposes)
 */
router.post('/rules/:id/trigger', requireLogin, async (req, res) => {
    try {
        const pool = req.app.locals.pool;
        const userId = req.session.user.id;
        const ruleId = req.params.id;

        // Validate UUID format
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(ruleId)) {
            return res.status(400).json({ error: 'Invalid rule ID format' });
        }

        // Get the rule
        const ruleResult = await pool.query(`
            SELECT * FROM notification_rules WHERE id = $1 AND user_id = $2
        `, [ruleId, userId]);

        if (ruleResult.rows.length === 0) {
            return res.status(404).json({ error: 'Rule not found' });
        }

        const rule = ruleResult.rows[0];

        // Create mock sensor data for manual trigger
        const mockSensorData = {
            sensor_box: rule.sensor_id,
            sensor_type: rule.sensor_type,
            value: parseFloat(rule.threshold) + (rule.condition.includes('>') ? 1 : -1),
            timestamp: new Date().toISOString()
        };

        // Build and send notification
        const payload = notificationService.buildNotificationPayload(rule, mockSensorData);

        // Inject webhook-specific metadata if this is a webhook rule
        if (rule.notification_provider === 'webhook') {
            payload.metadata = payload.metadata || {};
            payload.metadata.httpMethod = rule.webhook_http_method || 'POST';
            payload.metadata.customPayload = rule.webhook_payload || null;
            payload.metadata.authHeader = rule.webhook_auth_header || null;
            payload.metadata.sensorData = mockSensorData;
        }
        const result = await notificationService.send(rule.notification_provider, payload);

        if (result.success) {
            // Update trigger metadata
            await pool.query(`
                UPDATE notification_rules
                SET last_triggered_at = NOW(), trigger_count = trigger_count + 1
                WHERE id = $1
            `, [ruleId]);

            // Log to history
            await pool.query(`
                INSERT INTO notification_history 
                (rule_id, user_id, sensor_id, sensor_type, sensor_value, threshold, condition,
                 notification_provider, notification_target, notification_status)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'sent')
            `, [
                ruleId, userId, rule.sensor_id, rule.sensor_type,
                mockSensorData.value, rule.threshold, rule.condition,
                rule.notification_provider, rule.notification_target
            ]);
        }

        res.status(200).json({
            success: result.success,
            message: result.success
                ? `Test notification sent to ${rule.notification_target}`
                : `Failed to send notification: ${result.error}`,
            result
        });

    } catch (error) {
        console.error('Error triggering notification rule:', error);
        res.status(500).json({ error: 'Failed to trigger notification rule' });
    }
});

/**
 * GET /api/notifications/history
 * Get notification history for the current user
 */
router.get('/history', requireLogin, async (req, res) => {
    try {
        const pool = req.app.locals.pool;
        const userId = req.session.user.id;

        // Parse query parameters
        const limit = Math.min(parseInt(req.query.limit) || 50, 500);
        const offset = parseInt(req.query.offset) || 0;
        const status = req.query.status; // Optional filter: sent, failed, cooldown_skipped

        let query = `
            SELECT 
                h.id, h.rule_id, h.sensor_id, h.sensor_type, h.sensor_value,
                h.threshold, h.condition, h.notification_provider, h.notification_target,
                h.notification_status, h.error_message, h.sent_at,
                r.name as rule_name
            FROM notification_history h
            LEFT JOIN notification_rules r ON h.rule_id = r.id
            WHERE h.user_id = $1
        `;
        const values = [userId];
        let paramIndex = 2;

        if (status) {
            query += ` AND h.notification_status = $${paramIndex}`;
            values.push(status);
            paramIndex++;
        }

        query += ` ORDER BY h.sent_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        values.push(limit, offset);

        const result = await pool.query(query, values);

        // Get total count
        let countQuery = 'SELECT COUNT(*) FROM notification_history WHERE user_id = $1';
        const countValues = [userId];
        if (status) {
            countQuery += ' AND notification_status = $2';
            countValues.push(status);
        }
        const countResult = await pool.query(countQuery, countValues);

        res.status(200).json({
            history: result.rows,
            count: result.rows.length,
            total: parseInt(countResult.rows[0].count),
            limit,
            offset
        });

    } catch (error) {
        console.error('Error fetching notification history:', error);
        res.status(500).json({ error: 'Failed to fetch notification history' });
    }
});

/**
 * GET /api/notifications/providers
 * Get available notification providers
 */
router.get('/providers', requireLogin, (req, res) => {
    const providers = notificationService.getProviderNames().map(name => ({
        name,
        description: getProviderDescription(name)
    }));

    res.status(200).json({ providers });
});

/**
 * GET /api/notifications/status
 * Get rule engine status (admin or current user)
 */
router.get('/status', requireLogin, (req, res) => {
    const status = ruleEngine.getStatus();
    res.status(200).json(status);
});

/**
 * Get description for a provider
 * @param {string} providerName - The provider name
 * @returns {string} - Description
 */
function getProviderDescription(providerName) {
    const descriptions = {
        'ntfy': 'Push notifications via ntfy.sh - supports mobile and desktop notifications',
        'webhook': 'Custom HTTP webhook - call any external URL with sensor data (smart plugs, IFTTT, etc.)',
        'email': 'Email notifications (not yet implemented)',
        'sms': 'SMS notifications (not yet implemented)'
    };
    return descriptions[providerName] || 'Custom notification provider';
}

export default router;

