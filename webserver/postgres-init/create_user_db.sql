CREATE TABLE
  public.users (
    id serial NOT NULL,
    username character varying(255) NOT NULL DEFAULT now(),
    created_at timestamp without time zone NULL,
    role character varying(255) NULL,
    password character varying(255) NULL
  );

ALTER TABLE
  public.users
ADD
  CONSTRAINT untitled_table_pkey PRIMARY KEY (id);


CREATE EXTENSION IF NOT EXISTS pgcrypto;


ALTER TABLE public.users
  ALTER COLUMN created_at SET DEFAULT now();


ALTER TABLE public.users
  ALTER COLUMN username DROP DEFAULT;


ALTER TABLE public.users ADD CONSTRAINT users_username_key UNIQUE (username);




CREATE OR REPLACE FUNCTION public.users_hash_password() RETURNS trigger AS $$
BEGIN
  IF NEW.password IS NOT NULL THEN
    
    IF NEW.password !~ '^\\$' THEN
      NEW.password := crypt(NEW.password, gen_salt('bf'));
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


DROP TRIGGER IF EXISTS trg_users_hash_password ON public.users;
CREATE TRIGGER trg_users_hash_password
BEFORE INSERT OR UPDATE OF password ON public.users
FOR EACH ROW EXECUTE FUNCTION public.users_hash_password();


-- ----------------------------
-- Roles and Permissions (RBAC + rate limits)
-- ----------------------------

-- Roles catalog
CREATE TABLE IF NOT EXISTS public.roles (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE
);

-- Seed roles from existing users (non-null distinct values)
INSERT INTO public.roles(name)
SELECT DISTINCT role FROM public.users WHERE role IS NOT NULL
ON CONFLICT (name) DO NOTHING;

-- Add FK constraint from users.role -> roles(name) for referential integrity
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'users_role_fkey'
      AND table_name = 'users'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_role_fkey FOREIGN KEY (role)
      REFERENCES public.roles(name) ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END $$;

-- Permissions table (used by middleware)
CREATE TABLE IF NOT EXISTS public.permissions (
  id SERIAL PRIMARY KEY,
  role TEXT NOT NULL,
  method TEXT NOT NULL DEFAULT '*',
  path_pattern TEXT NOT NULL,
  match_type TEXT NOT NULL DEFAULT 'prefix',
  allow BOOLEAN NOT NULL DEFAULT TRUE,
  rate_limit_max INT DEFAULT 0,
  rate_limit_window_ms INT DEFAULT 0,
  CONSTRAINT permissions_role_fk FOREIGN KEY (role) REFERENCES public.roles(name) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT permissions_unique UNIQUE (role, method, path_pattern, match_type)
);

CREATE INDEX IF NOT EXISTS idx_permissions_role ON public.permissions(role);

-- ----------------------------
-- Seed default permissions (idempotent)
-- ----------------------------

-- Ensure baseline roles exist
INSERT INTO public.roles(name) VALUES ('anonymous') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.roles(name) VALUES ('user') ON CONFLICT (name) DO NOTHING;
INSERT INTO public.roles(name) VALUES ('admin') ON CONFLICT (name) DO NOTHING;

-- Anonymous: default deny all
INSERT INTO public.permissions(role, method, path_pattern, match_type, allow)
VALUES ('anonymous','*','/','prefix', false)
ON CONFLICT (role, method, path_pattern, match_type) DO NOTHING;

-- Anonymous: allow register/login with small rate limits
INSERT INTO public.permissions(role, method, path_pattern, match_type, allow, rate_limit_max, rate_limit_window_ms)
VALUES
('anonymous','POST','/api/users/register','exact', true, 10, 60000),
('anonymous','POST','/api/users/login','exact', true, 20, 60000)
ON CONFLICT (role, method, path_pattern, match_type) DO NOTHING;

-- User: allow sensors API with reasonable limits
INSERT INTO public.permissions(role, method, path_pattern, match_type, allow, rate_limit_max, rate_limit_window_ms)
VALUES
('user','GET','/api/sensors','prefix', true, 120, 60000),
('user','POST','/api/sensors','prefix', true, 30, 60000),
('user','GET','/api/devices','prefix', true, 30, 60000)
ON CONFLICT (role, method, path_pattern, match_type) DO NOTHING;

-- User: allow own profile/me endpoints
INSERT INTO public.permissions(role, method, path_pattern, match_type, allow)
VALUES ('user','GET','/api/users/me','exact', true)
ON CONFLICT (role, method, path_pattern, match_type) DO NOTHING;

-- Admin: full access, no rate limits
INSERT INTO public.permissions(role, method, path_pattern, match_type, allow, rate_limit_max, rate_limit_window_ms)
VALUES ('admin','*','/','prefix', true, 0, 0)
ON CONFLICT (role, method, path_pattern, match_type) DO NOTHING;

-- ----------------------------
-- BLE Device Connections Table
-- ----------------------------

-- Table to store persistent BLE device connections
CREATE TABLE IF NOT EXISTS public.ble_connections (
  id SERIAL PRIMARY KEY,
  address VARCHAR(17) NOT NULL UNIQUE, -- MAC address format: XX:XX:XX:XX:XX:XX
  name VARCHAR(255),
  display_name VARCHAR(255), -- User-friendly alias
  connected_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
  last_seen TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ble_connections_address ON public.ble_connections(address);
CREATE INDEX IF NOT EXISTS idx_ble_connections_active ON public.ble_connections(is_active);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_ble_connections_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at
DROP TRIGGER IF EXISTS trg_update_ble_connections_updated_at ON public.ble_connections;
CREATE TRIGGER trg_update_ble_connections_updated_at
BEFORE UPDATE ON public.ble_connections
FOR EACH ROW
EXECUTE FUNCTION update_ble_connections_updated_at();

-- ----------------------------
-- Session Table (connect-pg-simple)
-- ----------------------------
CREATE TABLE IF NOT EXISTS "session" (
  "sid" varchar NOT NULL COLLATE "default",
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL
)
WITH (OIDS=FALSE);

ALTER TABLE "session" ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE;
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");

-- ----------------------------
-- Grant Permissions to web_app
-- ----------------------------
-- Grant usage on sequences (important for SERIAL columns)
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO web_app;

-- Grant table permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON public.users TO web_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.roles TO web_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.permissions TO web_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ble_connections TO web_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON public."session" TO web_app;
