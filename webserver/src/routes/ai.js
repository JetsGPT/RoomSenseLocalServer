/**
 * AI Chat Routes
 *
 * REST endpoints for AI-powered chat with real-time sensor data access,
 * plus conversation persistence (list, get, delete, continue).
 */

import express from 'express';
import { requireLogin } from '../auth/auth.js';
import aiService from '../services/AiService.js';
import chatService from '../services/ChatService.js';

const router = express.Router();

// ========================================================================
// Chat
// ========================================================================

/**
 * POST /api/ai/chat
 *
 * Send a message to the AI and get a response.
 * If conversationId is provided, continues that conversation.
 * If not, creates a new conversation automatically.
 *
 * Request body:
 *   { message: string, conversationId?: string }
 *
 * Response:
 *   { response: string, conversationHistory: Array, conversationId: string }
 */
router.post('/chat', requireLogin, async (req, res) => {
    try {
        const { message, conversationId } = req.body;

        if (!message || typeof message !== 'string' || message.trim().length === 0) {
            return res.status(400).json({ error: 'Message is required' });
        }

        if (message.length > 2000) {
            return res.status(400).json({ error: 'Message too long (max 2000 characters)' });
        }

        const userId = req.session.user.id;
        const pool = req.app.locals.pool;

        console.log(`[AI] Chat request from user ${userId}: "${message.substring(0, 80)}..."`);

        // Load existing conversation or prepare a new one
        let existingConversation = null;
        let conversationHistory = [];
        let displayMessages = [];

        if (conversationId) {
            existingConversation = await chatService.getConversation(pool, userId, conversationId);
            if (!existingConversation) {
                return res.status(404).json({ error: 'Conversation not found' });
            }
            conversationHistory = existingConversation.conversation_history || [];
            displayMessages = existingConversation.messages || [];
        }

        // Call AI
        const result = await aiService.chat(
            message.trim(),
            conversationHistory,
            userId
        );

        // Build updated display messages
        const now = new Date().toISOString();
        displayMessages = [
            ...displayMessages,
            { role: 'user', text: message.trim(), timestamp: now },
            { role: 'ai', text: result.response, timestamp: now }
        ];

        // Auto-title from first user message
        const title = displayMessages.length === 2
            ? message.trim().substring(0, 80)
            : undefined;

        // Persist
        let activeConversationId;
        if (existingConversation) {
            await chatService.updateConversation(
                pool, userId, conversationId,
                displayMessages, result.conversationHistory, title
            );
            activeConversationId = conversationId;
        } else {
            const newConv = await chatService.createConversation(
                pool, userId,
                message.trim().substring(0, 80)
            );
            await chatService.updateConversation(
                pool, userId, newConv.id,
                displayMessages, result.conversationHistory
            );
            activeConversationId = newConv.id;
        }

        res.status(200).json({
            response: result.response,
            conversationHistory: result.conversationHistory,
            conversationId: activeConversationId
        });

    } catch (error) {
        console.error('[AI] Chat error:', error);

        if (error.message?.includes('API key')) {
            return res.status(503).json({ error: 'AI service not configured' });
        }

        res.status(500).json({ error: 'Failed to process AI request', details: error.message });
    }
});

// ========================================================================
// Insights & Analysis
// ========================================================================

/**
 * POST /api/ai/analyze
 *
 * Analyze sensor and weather data over a specific time range to generate insights.
 *
 * Request body:
 *   { sensorData: Array, weatherData: Array, timeRange: string }
 *
 * Response:
 *   { analysis: string }
 */
router.post('/analyze', requireLogin, async (req, res) => {
    try {
        const { sensorData, weatherData, timeRange } = req.body;

        if (!sensorData || !Array.isArray(sensorData)) {
            return res.status(400).json({ error: 'sensorData must be an array' });
        }
        if (!weatherData || !Array.isArray(weatherData)) {
            return res.status(400).json({ error: 'weatherData must be an array' });
        }
        if (!timeRange) {
            return res.status(400).json({ error: 'timeRange is required' });
        }

        const userId = req.session.user.id;
        console.log(`[AI] Analyze request from user ${userId} for time range: ${timeRange}`);


        const trimmedSensorData = sensorData.slice(-500);
        const trimmedWeatherData = weatherData.slice(-500);

        const analysis = await aiService.analyzeOverview(
            trimmedSensorData,
            trimmedWeatherData,
            timeRange
        );

        res.status(200).json({ analysis });

    } catch (error) {
        console.error('[AI] Analyze error:', error);

        if (error.message?.includes('API key')) {
            return res.status(503).json({ error: 'AI service not configured' });
        }

        res.status(500).json({ error: 'Failed to generate analysis', details: error.message });
    }
});

// ========================================================================
// Conversations CRUD
// ========================================================================

/**
 * GET /api/ai/conversations
 * List all conversations for the authenticated user.
 */
router.get('/conversations', requireLogin, async (req, res) => {
    try {
        const userId = req.session.user.id;
        const pool = req.app.locals.pool;
        const conversations = await chatService.listConversations(pool, userId);
        res.status(200).json(conversations);
    } catch (error) {
        console.error('[AI] List conversations error:', error);
        res.status(500).json({ error: 'Failed to list conversations' });
    }
});

/**
 * GET /api/ai/conversations/:id
 * Get a single conversation with full messages.
 */
router.get('/conversations/:id', requireLogin, async (req, res) => {
    try {
        const userId = req.session.user.id;
        const pool = req.app.locals.pool;
        const conversation = await chatService.getConversation(pool, userId, req.params.id);
        if (!conversation) {
            return res.status(404).json({ error: 'Conversation not found' });
        }
        res.status(200).json(conversation);
    } catch (error) {
        console.error('[AI] Get conversation error:', error);
        res.status(500).json({ error: 'Failed to get conversation' });
    }
});

/**
 * DELETE /api/ai/conversations/:id
 * Delete a conversation.
 */
router.delete('/conversations/:id', requireLogin, async (req, res) => {
    try {
        const userId = req.session.user.id;
        const pool = req.app.locals.pool;
        const deleted = await chatService.deleteConversation(pool, userId, req.params.id);
        if (!deleted) {
            return res.status(404).json({ error: 'Conversation not found' });
        }
        res.status(200).json({ success: true });
    } catch (error) {
        console.error('[AI] Delete conversation error:', error);
        res.status(500).json({ error: 'Failed to delete conversation' });
    }
});

// ========================================================================
// Status
// ========================================================================

/**
 * GET /api/ai/status
 * Check if the AI service is available and configured.
 */
router.get('/status', requireLogin, (req, res) => {
    res.status(200).json({
        available: !!aiService.genAI,
        model: 'gemini-3-flash-preview'
    });
});

export default router;
