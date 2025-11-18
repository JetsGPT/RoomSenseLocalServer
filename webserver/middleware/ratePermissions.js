import url from 'url';

// DB-backed permissions and rate limit middleware
// Table expectation (example):
// permissions(role TEXT, method TEXT, path_pattern TEXT, match_type TEXT, allow BOOLEAN, rate_limit_max INT, rate_limit_window_ms INT)
// match_type: 'prefix' | 'exact'

const defaultCacheMs = process.env.PERM_CACHE_MS ? parseInt(process.env.PERM_CACHE_MS) : 30000;
const trustProxy = process.env.RATE_LIMIT_TRUST_PROXY === '1' || process.env.TRUST_PROXY === '1';

// In-memory caches
const permissionsCache = new Map(); // role -> { rules, expiresAt }
const counters = new Map(); // key -> { count, resetAt }
let ensureSchemaPromise = null;

function getClientKey(req) {
  if (req?.session?.user?.id) return `user:${req.session.user.id}`;
  if (req?.session?.isPopulated) return `sess:${req.sessionID}`;
  return req.ip;
}

function matchRule(rules, method, path) {
  // Prefer exact matches, then longest prefix match
  let best = null;
  for (const r of rules) {
    if (r.method && r.method !== '*' && r.method.toUpperCase() !== method.toUpperCase()) continue;
    if (r.match_type === 'exact') {
      if (r.path_pattern === path) return r;
    } else { // prefix default
      if (path === r.path_pattern || path.startsWith(r.path_pattern.endsWith('/') ? r.path_pattern : r.path_pattern + '/')) {
        if (!best || (r.path_pattern.length > best.path_pattern.length)) best = r;
      }
    }
  }
  return best;
}

async function ensurePermissionsSchema(pool) {
  if (ensureSchemaPromise) return ensureSchemaPromise;

  ensureSchemaPromise = (async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(`
        CREATE TABLE IF NOT EXISTS roles (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL UNIQUE
        )
      `);

      await client.query(`
        CREATE TABLE IF NOT EXISTS permissions (
          id SERIAL PRIMARY KEY,
          role TEXT NOT NULL,
          method TEXT NOT NULL DEFAULT '*',
          path_pattern TEXT NOT NULL,
          match_type TEXT NOT NULL DEFAULT 'prefix',
          allow BOOLEAN NOT NULL DEFAULT TRUE,
          rate_limit_max INT DEFAULT 0,
          rate_limit_window_ms INT DEFAULT 0,
          CONSTRAINT permissions_role_fk
            FOREIGN KEY (role)
            REFERENCES roles(name)
            ON UPDATE CASCADE
            ON DELETE CASCADE,
          CONSTRAINT permissions_unique
            UNIQUE (role, method, path_pattern, match_type)
        )
      `);

      await client.query(`CREATE INDEX IF NOT EXISTS idx_permissions_role ON permissions(role)`);

      await client.query(`
        INSERT INTO roles(name)
        VALUES ('anonymous'), ('user'), ('admin')
        ON CONFLICT (name) DO NOTHING
      `);

      await client.query(`
        INSERT INTO permissions(role, method, path_pattern, match_type, allow, rate_limit_max, rate_limit_window_ms)
        VALUES
          ('anonymous','*','/','prefix', false, 0, 0),
          ('anonymous','POST','/api/users/register','exact', true, 10, 60000),
          ('anonymous','POST','/api/users/login','exact', true, 20, 60000),
          ('user','GET','/api/sensors','prefix', true, 120, 60000),
          ('user','POST','/api/sensors','prefix', true, 30, 60000),
          ('user','GET','/api/devices','prefix', true, 30, 60000),
          ('user','GET','/api/users/me','exact', true, 0, 0),
          ('admin','*','/','prefix', true, 0, 0)
        ON CONFLICT (role, method, path_pattern, match_type) DO NOTHING
      `);

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  })();

  try {
    await ensureSchemaPromise;
  } catch (err) {
    ensureSchemaPromise = null;
    throw err;
  }
}

async function loadRulesForRole(pool, role) {
  const now = Date.now();
  const cached = permissionsCache.get(role);
  if (cached && cached.expiresAt > now) return cached.rules;

  await ensurePermissionsSchema(pool);

  const query = `
    SELECT role, method, path_pattern, COALESCE(match_type,'prefix') AS match_type, allow,
           COALESCE(rate_limit_max, 0) AS rate_limit_max,
           COALESCE(rate_limit_window_ms, 0) AS rate_limit_window_ms
    FROM permissions
    WHERE role = $1
  `;
  const { rows } = await pool.query(query, [role]);
  const rules = rows.map(r => ({
    role: r.role,
    method: r.method || '*',
    path_pattern: r.path_pattern || '/',
    match_type: r.match_type || 'prefix',
    allow: !!r.allow,
    rate_limit_max: Number(r.rate_limit_max) || 0,
    rate_limit_window_ms: Number(r.rate_limit_window_ms) || 0,
  }));
  permissionsCache.set(role, { rules, expiresAt: now + defaultCacheMs });
  return rules;
}

function enforceCounter(key, limit, windowMs) {
  const now = Date.now();
  const rec = counters.get(key);
  if (!rec || rec.resetAt <= now) {
    counters.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, resetAt: now + windowMs };
  }
  if (rec.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: rec.resetAt };
  }
  rec.count += 1;
  return { allowed: true, remaining: limit - rec.count, resetAt: rec.resetAt };
}

export default function ratePermissions() {
  return async function (req, res, next) {
    try {
      // Dev mode bypass - skip rate limiting and permissions in dev
      const devBypassValue = process.env.DEV_BYPASS_AUTH;
      const devBypass = devBypassValue === '1' || devBypassValue === 'true' || devBypassValue === 1;
      
      if (devBypass) {
        console.log('[DEV MODE] Bypassing rate limiter for:', req.method, req.path);
        return next();
      }
      
      // Debug: log if env var is set but not matching
      if (devBypassValue !== undefined && !devBypass) {
        console.log('[DEBUG] DEV_BYPASS_AUTH is set but not matching:', devBypassValue, typeof devBypassValue);
      }

      if (trustProxy) req.app.set('trust proxy', 1);
      const pool = req.app?.locals?.pool;
      if (!pool) return next(new Error('Database pool is not available'));

      const role = req?.session?.user?.role || 'anonymous';
      const method = req.method;
      const path = url.parse(req.originalUrl || req.url).pathname || '/';

      const rules = await loadRulesForRole(pool, role);
      const rule = matchRule(rules, method, path);

      if (rule && rule.allow === false) {
        console.warn('Permission denied', { path, method, role });
        return res.status(403).json({ error: 'Forbidden' });
      }

      // Rate limiting if configured
      if (rule && rule.rate_limit_max > 0 && rule.rate_limit_window_ms > 0) {
        const clientKey = getClientKey(req);
        const policyKey = `${clientKey}|${role}|${rule.method}|${rule.path_pattern}`;
        const result = enforceCounter(policyKey, rule.rate_limit_max, rule.rate_limit_window_ms);
        if (!result.allowed) {
          console.warn('Rate limit exceeded', { path, method, role, clientKey });
          res.setHeader('Retry-After', Math.ceil((result.resetAt - Date.now()) / 1000));
          return res.status(429).json({ error: 'Too Many Requests' });
        }
        res.setHeader('X-RateLimit-Limit', String(rule.rate_limit_max));
        res.setHeader('X-RateLimit-Remaining', String(result.remaining));
        res.setHeader('X-RateLimit-Reset', String(Math.floor(result.resetAt / 1000)));
      }

      next();
    } catch (err) {
      console.error('ratePermissions middleware error', err);
      next(err);
    }
  };
}
