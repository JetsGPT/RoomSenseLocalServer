-- ============================================================================
-- Notification Rules Schema
-- ============================================================================

-- Table to store notification rules for sensor thresholds
CREATE TABLE IF NOT EXISTS public.notification_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    sensor_id VARCHAR(255) NOT NULL, -- sensor_box identifier or '*' for all
    sensor_type VARCHAR(100) NOT NULL, -- temperature, humidity, pressure, etc.
    condition VARCHAR(10) NOT NULL CHECK (condition IN ('>', '<', '>=', '<=', '==', '!=')),
    threshold NUMERIC(10, 2) NOT NULL,
    notification_provider VARCHAR(50) NOT NULL DEFAULT 'ntfy', -- ntfy, email, sms, etc.
    notification_target VARCHAR(255) NOT NULL, -- ntfy topic, email address, phone number
    notification_priority VARCHAR(20) DEFAULT 'default', -- low, default, high, urgent
    notification_title VARCHAR(255), -- custom title template
    notification_message TEXT, -- custom message template
    cooldown_seconds INTEGER DEFAULT 300, -- minimum time between notifications (5 min default)
    is_enabled BOOLEAN DEFAULT TRUE,
    last_triggered_at TIMESTAMP WITH TIME ZONE,
    trigger_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_notification_rules_user_id ON public.notification_rules(user_id);
CREATE INDEX IF NOT EXISTS idx_notification_rules_enabled ON public.notification_rules(is_enabled);
CREATE INDEX IF NOT EXISTS idx_notification_rules_sensor_type ON public.notification_rules(sensor_type);
CREATE INDEX IF NOT EXISTS idx_notification_rules_sensor_id ON public.notification_rules(sensor_id);

-- Trigger to automatically update updated_at
CREATE OR REPLACE FUNCTION update_notification_rules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notification_rules_updated_at ON public.notification_rules;
CREATE TRIGGER trg_notification_rules_updated_at
BEFORE UPDATE ON public.notification_rules
FOR EACH ROW
EXECUTE FUNCTION update_notification_rules_updated_at();

-- ============================================================================
-- Notification History Table (for audit and debugging)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.notification_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id UUID REFERENCES notification_rules(id) ON DELETE SET NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    sensor_id VARCHAR(255) NOT NULL,
    sensor_type VARCHAR(100) NOT NULL,
    sensor_value NUMERIC(10, 2) NOT NULL,
    threshold NUMERIC(10, 2) NOT NULL,
    condition VARCHAR(10) NOT NULL,
    notification_provider VARCHAR(50) NOT NULL,
    notification_target VARCHAR(255) NOT NULL,
    notification_status VARCHAR(20) NOT NULL, -- sent, failed, cooldown_skipped
    error_message TEXT,
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_history_rule_id ON public.notification_history(rule_id);
CREATE INDEX IF NOT EXISTS idx_notification_history_user_id ON public.notification_history(user_id);
CREATE INDEX IF NOT EXISTS idx_notification_history_sent_at ON public.notification_history(sent_at);

-- ============================================================================
-- Permissions for notification rules API
-- ============================================================================

-- User: allow notifications API with reasonable limits
INSERT INTO public.permissions(role, method, path_pattern, match_type, allow, rate_limit_max, rate_limit_window_ms)
VALUES
('user','GET','/api/notifications','prefix', true, 60, 60000),
('user','POST','/api/notifications','prefix', true, 30, 60000),
('user','PUT','/api/notifications','prefix', true, 30, 60000),
('user','DELETE','/api/notifications','prefix', true, 30, 60000)
ON CONFLICT (role, method, path_pattern, match_type) DO NOTHING;

-- Admin: allow notifications API with higher limits
INSERT INTO public.permissions(role, method, path_pattern, match_type, allow, rate_limit_max, rate_limit_window_ms)
VALUES
('admin','GET','/api/notifications','prefix', true, 120, 60000),
('admin','POST','/api/notifications','prefix', true, 60, 60000),
('admin','PUT','/api/notifications','prefix', true, 60, 60000),
('admin','DELETE','/api/notifications','prefix', true, 60, 60000)
ON CONFLICT (role, method, path_pattern, match_type) DO NOTHING;

-- ============================================================================
-- Grant Permissions to web_app
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_rules TO web_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_history TO web_app;

