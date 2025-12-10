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



async function loadRulesForRole(pool, role) {
  const now = Date.now();
  const cached = permissionsCache.get(role);
  if (cached && cached.expiresAt > now) return cached.rules;



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
      // Enforce rate limits and permissions (no bypass)

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
