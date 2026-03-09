/**
 * ChatService
 *
 * CRUD operations for AI chat conversations stored in PostgreSQL.
 * All queries are scoped to the authenticated user's ID.
 */

class ChatService {
    /**
     * List all conversations for a user (summary only — no full messages).
     * Ordered by most recently updated first.
     */
    async listConversations(pool, userId) {
        const result = await pool.query(
            `SELECT id, title, created_at, updated_at,
                    jsonb_array_length(messages) AS message_count
             FROM ai_conversations
             WHERE user_id = $1
             ORDER BY updated_at DESC`,
            [userId]
        );
        return result.rows;
    }

    /**
     * Get a single conversation with full messages and history.
     * Returns null if not found or not owned by the user.
     */
    async getConversation(pool, userId, conversationId) {
        const result = await pool.query(
            `SELECT id, title, messages, conversation_history, created_at, updated_at
             FROM ai_conversations
             WHERE id = $1 AND user_id = $2`,
            [conversationId, userId]
        );
        return result.rows[0] || null;
    }

    /**
     * Create a new conversation. Returns the created row.
     */
    async createConversation(pool, userId, title = 'New Chat') {
        const result = await pool.query(
            `INSERT INTO ai_conversations (user_id, title)
             VALUES ($1, $2)
             RETURNING id, title, messages, conversation_history, created_at, updated_at`,
            [userId, title]
        );
        return result.rows[0];
    }

    /**
     * Update messages, conversation history, and optionally the title.
     * Returns the updated row, or null if not found / not owned.
     */
    async updateConversation(pool, userId, conversationId, messages, conversationHistory, title) {
        let query, values;

        if (title !== undefined && title !== null) {
            query = `UPDATE ai_conversations
                     SET messages = $1, conversation_history = $2, title = $3
                     WHERE id = $4 AND user_id = $5
                     RETURNING id, title, messages, conversation_history, created_at, updated_at`;
            values = [JSON.stringify(messages), JSON.stringify(conversationHistory), title, conversationId, userId];
        } else {
            query = `UPDATE ai_conversations
                     SET messages = $1, conversation_history = $2
                     WHERE id = $3 AND user_id = $4
                     RETURNING id, title, messages, conversation_history, created_at, updated_at`;
            values = [JSON.stringify(messages), JSON.stringify(conversationHistory), conversationId, userId];
        }

        const result = await pool.query(query, values);
        return result.rows[0] || null;
    }

    /**
     * Delete a conversation. Returns true if deleted, false if not found.
     */
    async deleteConversation(pool, userId, conversationId) {
        const result = await pool.query(
            `DELETE FROM ai_conversations
             WHERE id = $1 AND user_id = $2`,
            [conversationId, userId]
        );
        return result.rowCount > 0;
    }
}

// Singleton
const chatService = new ChatService();
export default chatService;
