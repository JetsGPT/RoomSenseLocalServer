-- ----------------------------
-- System Settings Table (Key-Value Store)
-- ----------------------------
-- Used for admin-configurable settings like API keys.
-- Sensitive values (e.g. API keys) are stored with a flag for UI masking.

CREATE TABLE IF NOT EXISTS public.system_settings (
    key VARCHAR(255) PRIMARY KEY,
    value TEXT,
    is_sensitive BOOLEAN DEFAULT FALSE,
    description TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_by INTEGER REFERENCES users(id)
);

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_system_settings_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_system_settings_updated_at ON public.system_settings;
CREATE TRIGGER trg_system_settings_updated_at
BEFORE UPDATE ON public.system_settings
FOR EACH ROW
EXECUTE FUNCTION update_system_settings_timestamp();

-- Grant permissions to web_app role
GRANT SELECT, INSERT, UPDATE, DELETE ON public.system_settings TO web_app;
