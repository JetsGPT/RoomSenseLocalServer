-- Add permission for /api/devices endpoint for 'user' role
-- Run this in your PostgreSQL database

INSERT INTO public.permissions(role, method, path_pattern, match_type, allow, rate_limit_max, rate_limit_window_ms)
VALUES ('user','GET','/api/devices','prefix', true, 30, 60000)
ON CONFLICT (role, method, path_pattern, match_type) DO NOTHING;

