-- ----------------------------
-- AI Conversations Table
-- ----------------------------
-- Stores AI chat conversations per user for history tracking.

CREATE TABLE IF NOT EXISTS public.ai_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL DEFAULT 'New Chat',
    messages JSONB NOT NULL DEFAULT '[]',
    conversation_history JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_conversations_user_id ON public.ai_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_updated_at ON public.ai_conversations(updated_at DESC);

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_ai_conversations_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ai_conversations_updated_at ON public.ai_conversations;
CREATE TRIGGER trg_ai_conversations_updated_at
BEFORE UPDATE ON public.ai_conversations
FOR EACH ROW
EXECUTE FUNCTION update_ai_conversations_timestamp();

-- Grant permissions to web_app role
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_conversations TO web_app;

-- Allow 'user' role to access AI chat endpoints
INSERT INTO public.permissions(role, method, path_pattern, match_type, allow, rate_limit_max, rate_limit_window_ms)
VALUES
('user','GET','/api/ai','prefix', true, 60, 60000),
('user','POST','/api/ai','prefix', true, 30, 60000),
('user','DELETE','/api/ai','prefix', true, 20, 60000)
ON CONFLICT (role, method, path_pattern, match_type) DO NOTHING;
