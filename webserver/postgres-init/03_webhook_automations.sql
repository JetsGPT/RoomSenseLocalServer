-- ============================================================================
-- Webhook Automation Columns
-- Adds webhook-specific fields to notification_rules for the webhook provider.
-- ============================================================================

-- HTTP method for webhook calls (POST, GET, PUT, PATCH)
ALTER TABLE public.notification_rules
    ADD COLUMN IF NOT EXISTS webhook_http_method VARCHAR(10) DEFAULT 'POST';

-- Custom JSON payload template (null = auto-generated from sensor data)
ALTER TABLE public.notification_rules
    ADD COLUMN IF NOT EXISTS webhook_payload JSONB DEFAULT NULL;

-- Auth header for webhook calls (e.g. "Bearer token" or "X-API-Key: value")
ALTER TABLE public.notification_rules
    ADD COLUMN IF NOT EXISTS webhook_auth_header VARCHAR(500) DEFAULT NULL;
