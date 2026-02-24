/**
 * Settings Route (Admin Only)
 *
 * CRUD API for system settings (e.g. API keys).
 * Only admins can read/write settings.
 * Sensitive values are masked in GET responses.
 */

import express from 'express';
import { requireLogin, requireRole } from '../auth/auth.js';

const router = express.Router();

/**
 * GET /api/settings
 * Get all system settings (sensitive values are masked)
 */
router.get('/', requireLogin, requireRole('admin'), async (req, res) => {
    try {
        const pool = req.app.locals.pool;
        const result = await pool.query(
            'SELECT key, value, is_sensitive, description, updated_at FROM system_settings ORDER BY key'
        );

        // Mask sensitive values
        const settings = result.rows.map(row => ({
            ...row,
            value: row.is_sensitive && row.value ? maskValue(row.value) : row.value
        }));

        res.status(200).json(settings);
    } catch (error) {
        console.error('Error fetching settings:', error);
        res.status(500).json({ error: 'Failed to fetch settings' });
    }
});

/**
 * GET /api/settings/:key
 * Get a specific setting
 */
router.get('/:key', requireLogin, requireRole('admin'), async (req, res) => {
    try {
        const pool = req.app.locals.pool;
        const { key } = req.params;

        const result = await pool.query(
            'SELECT key, value, is_sensitive, description, updated_at FROM system_settings WHERE key = $1',
            [key]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Setting not found' });
        }

        const setting = result.rows[0];
        if (setting.is_sensitive && setting.value) {
            setting.value = maskValue(setting.value);
        }

        res.status(200).json(setting);
    } catch (error) {
        console.error('Error fetching setting:', error);
        res.status(500).json({ error: 'Failed to fetch setting' });
    }
});

/**
 * PUT /api/settings/:key
 * Create or update a setting
 */
router.put('/:key', requireLogin, requireRole('admin'), async (req, res) => {
    try {
        const pool = req.app.locals.pool;
        const { key } = req.params;
        const { value, description, is_sensitive } = req.body;

        // Validate key format
        if (!key || !/^[a-zA-Z0-9_.-]+$/.test(key) || key.length > 255) {
            return res.status(400).json({ error: 'Invalid key format' });
        }

        const userId = req.session.user.id;

        const result = await pool.query(`
            INSERT INTO system_settings (key, value, is_sensitive, description, updated_by)
            VALUES ($1, $2, COALESCE($3, FALSE), $4, $5)
            ON CONFLICT (key) DO UPDATE SET
                value = $2,
                is_sensitive = COALESCE($3, system_settings.is_sensitive),
                description = COALESCE($4, system_settings.description),
                updated_by = $5
            RETURNING key, is_sensitive, description, updated_at
        `, [key, value, is_sensitive, description, userId]);

        console.log(`✓ Setting '${key}' updated by user ${userId}`);

        // If this is the Gemini API key, notify the AI service to reload
        if (key === 'gemini_api_key') {
            // Dynamic import to avoid circular dependency
            const { default: aiService } = await import('../services/AiService.js');
            await aiService.reloadApiKey(pool);
        }

        res.status(200).json(result.rows[0]);
    } catch (error) {
        console.error('Error updating setting:', error);
        res.status(500).json({ error: 'Failed to update setting' });
    }
});

/**
 * DELETE /api/settings/:key
 * Delete a setting
 */
router.delete('/:key', requireLogin, requireRole('admin'), async (req, res) => {
    try {
        const pool = req.app.locals.pool;
        const { key } = req.params;

        const result = await pool.query(
            'DELETE FROM system_settings WHERE key = $1 RETURNING key',
            [key]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Setting not found' });
        }

        console.log(`✓ Setting '${key}' deleted by user ${req.session.user.id}`);
        res.status(200).json({ deleted: key });
    } catch (error) {
        console.error('Error deleting setting:', error);
        res.status(500).json({ error: 'Failed to delete setting' });
    }
});

/**
 * Mask a sensitive value for display (show first 4 and last 4 chars)
 */
function maskValue(value) {
    if (value.length <= 8) return '••••••••';
    return value.substring(0, 4) + '••••••••' + value.substring(value.length - 4);
}

export default router;
