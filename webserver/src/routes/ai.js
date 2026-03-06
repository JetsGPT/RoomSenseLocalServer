/**
 * AI Chat Route
 *
 * REST endpoint for AI-powered chat with real-time sensor data access.
 * POST /api/ai/chat
 */

import express from 'express';
import { requireLogin } from '../auth/auth.js';
import aiService from '../services/AiService.js';

const router = express.Router();

/**
 * POST /api/ai/chat
 *
 * Send a message to the AI and get a response.
 * The AI can call tools to fetch real-time sensor data, device info, etc.
 *
 * Request body:
 *   { message: string, conversationHistory?: Array }
 *
 * Response:
 *   { response: string, conversationHistory: Array }
 */
router.post('/chat', requireLogin, async (req, res) => {
    try {
        const { message, conversationHistory } = req.body;

        if (!message || typeof message !== 'string' || message.trim().length === 0) {
            return res.status(400).json({ error: 'Message is required' });
        }

        // Cap message length to prevent abuse
        if (message.length > 2000) {
            return res.status(400).json({ error: 'Message too long (max 2000 characters)' });
        }

        const userId = req.session.user.id;

        console.log(`[AI] Chat request from user ${userId}: "${message.substring(0, 80)}..."`);

        const result = await aiService.chat(
            message.trim(),
            conversationHistory || [],
            userId
        );

        res.status(200).json(result);

    } catch (error) {
        console.error('[AI] Chat error:', error);

        if (error.message?.includes('API key')) {
            return res.status(503).json({ error: 'AI service not configured' });
        }

        res.status(500).json({ error: 'Failed to process AI request', details: error.message });
    }
});

/**
 * GET /api/ai/status
 *
 * Check if the AI service is available and configured.
 */
router.get('/status', requireLogin, (req, res) => {
    res.status(200).json({
        available: !!aiService.genAI,
        model: 'gemini-3-flash-preview'
    });
});

export default router;
