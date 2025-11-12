import express from 'express';
import pg from 'pg'
import { requireLogin, requireRole } from '../auth/auth.js';

const router = express.Router();

const { Client } = pg
const options = {
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'password',
    host: process.env.PGHOST || 'postgres',
    port: process.env.PGPORT ? parseInt(process.env.PGPORT) : 5432,
    database: process.env.PGDATABASE || 'user',
};

// Keep user creation helper above routes to avoid any hoisting edge cases
async function createUser(username, password) {
    const pgClient = new Client(options);
    try {
        await pgClient.connect();
        await pgClient.query('BEGIN');
        await pgClient.query('SELECT pg_advisory_xact_lock($1)', [424242]);
        await pgClient.query('INSERT INTO roles(name) VALUES($1) ON CONFLICT (name) DO NOTHING', ['admin']);
        await pgClient.query('INSERT INTO roles(name) VALUES($1) ON CONFLICT (name) DO NOTHING', ['user']);
        const countRes = await pgClient.query('SELECT COUNT(*)::int AS c FROM users');
        const isFirst = (countRes.rows?.[0]?.c ?? 0) === 0;
        const assignRole = isFirst ? 'admin' : 'user';
        const result = await pgClient.query(
            'INSERT INTO users (username, password, role, created_at) VALUES ($1, $2, $3, NOW()) RETURNING id, username, role, created_at',
            [username, password, assignRole]
        );
        await pgClient.query('COMMIT');
        return result.rows?.[0] ?? null;
    } catch (error) {
        try { await pgClient.query('ROLLBACK'); } catch(e) {}
        console.error('Error creating user:', error);
        throw error;
    } finally {
        await pgClient.end();
    }
}

// Authenticate helper
async function authenticateUser(username, password) {
    const pgClient = new Client(options);
    try {
        await pgClient.connect();
        const result = await pgClient.query(
            'SELECT id, username, role, created_at FROM users WHERE username = $1 AND password = crypt($2, password) LIMIT 1',
            [username, password]
        );
        return result.rows?.[0] ?? null;
    } catch (error) {
        console.error('Error authenticating user:', error);
        throw error;
    } finally {
        await pgClient.end();
    }
}

// List users helper (admin only uses it); does not include password
async function fetchUsers() {
    const pgClient = new Client(options);
    try {
        await pgClient.connect();
        const result = await pgClient.query(
            'SELECT id, username, role, created_at FROM users ORDER BY id DESC'
        );
        return result.rows;
    } catch (error) {
        console.error('Error fetching users:', error);
        throw error;
    } finally {
        await pgClient.end();
    }
}

router.get('/all', requireLogin, requireRole('admin'), async (req, res) => {
    fetchUsers().then(users => {
        console.log('Fetched Users:', users);
        res.status(200).send(users)
    });
});

// Admin: list all roles
router.get('/roles', requireLogin, requireRole('admin'), async (req, res) => {
    const pgClient = new Client(options);
    try {
        await pgClient.connect();
        const { rows } = await pgClient.query('SELECT name FROM roles ORDER BY name ASC');
        res.status(200).send(rows.map(r => r.name));
    } catch (error) {
        console.error('Error listing roles:', error);
        res.status(500).send({ error: 'Failed to list roles' });
    } finally {
        await pgClient.end();
    }
});

// Admin: create a role
router.post('/roles', requireLogin, requireRole('admin'), async (req, res) => {
    const name = (req.body?.name || '').trim();
    if (!name) return res.status(400).send({ error: 'name is required' });
    if (name.length > 255) return res.status(400).send({ error: 'name too long' });
    const pgClient = new Client(options);
    try {
        await pgClient.connect();
        const { rowCount } = await pgClient.query('INSERT INTO roles(name) VALUES($1) ON CONFLICT (name) DO NOTHING', [name]);
        if (rowCount === 0) return res.status(409).send({ error: 'Role already exists' });
        res.status(201).send({ name });
    } catch (error) {
        console.error('Error creating role:', error);
        res.status(500).send({ error: 'Failed to create role' });
    } finally {
        await pgClient.end();
    }
});

// Admin: delete a role, optionally reassign users
router.delete('/roles/:role', requireLogin, requireRole('admin'), async (req, res) => {
    const role = (req.params.role || '').trim();
    // reassignTo can come from query or body
    let reassignTo = (req.query?.reassignTo || req.body?.reassignTo || '').trim();
    if (!role) return res.status(400).send({ error: 'role path param is required' });

    const pgClient = new Client(options);
    try {
        await pgClient.connect();
        await pgClient.query('BEGIN');
        const exists = await pgClient.query('SELECT 1 FROM roles WHERE name=$1 LIMIT 1', [role]);
        if (exists.rowCount === 0) {
            await pgClient.query('ROLLBACK');
            return res.status(404).send({ error: 'Role not found' });
        }
        if (reassignTo) {
            await pgClient.query('INSERT INTO roles(name) VALUES($1) ON CONFLICT (name) DO NOTHING', [reassignTo]);
            await pgClient.query('UPDATE users SET role=$1 WHERE role=$2', [reassignTo, role]);
        } else {
            // If not reassigning, users will end up with NULL due to FK when we delete the role
            await pgClient.query('UPDATE users SET role=NULL WHERE role=$1', [role]);
        }
        // Delete the role; permissions rows will cascade via FK
        await pgClient.query('DELETE FROM roles WHERE name=$1', [role]);
        await pgClient.query('COMMIT');
        res.status(200).send({ deleted: role, reassignedTo: reassignTo || null });
    } catch (error) {
        try { await pgClient.query('ROLLBACK'); } catch(e) {}
        console.error('Error deleting role:', error);
        res.status(500).send({ error: 'Failed to delete role' });
    } finally {
        await pgClient.end();
    }
});

// Admin: get permissions for a specific role
router.get('/roles/:role/permissions', requireLogin, requireRole('admin'), async (req, res) => {
    const role = (req.params.role || '').trim();
    if (!role) return res.status(400).send({ error: 'role path param is required' });
    const pgClient = new Client(options);
    try {
        await pgClient.connect();
        const { rows } = await pgClient.query(
            `SELECT role, method, path_pattern, match_type, allow, rate_limit_max, rate_limit_window_ms
             FROM permissions WHERE role=$1 ORDER BY path_pattern, method`,
            [role]
        );
        res.status(200).send({ role, permissions: rows });
    } catch (error) {
        console.error('Error fetching role permissions:', error);
        res.status(500).send({ error: 'Failed to fetch role permissions' });
    } finally {
        await pgClient.end();
    }
});

router.post('/register', async (req, res) => {
    let {user, password} = req.body;
    createUser(user, password).then(result => {
        console.log('Created user: ', result);
        res.status(200).send(result)
    }).catch(err => {
        if (err && err.code === '23505') {
            return res.status(409).send({ error: 'Username already exists' });
        }
        res.status(500).send({ error: 'Failed to create user' })
    });
})

router.post('/login', async (req, res) => {
    const { user, password } = req.body;
    if (!user || !password) {
        return res.status(400).send({ error: 'user and password are required' });
    }
    try {
        const authUser = await authenticateUser(user, password);
        if (!authUser) {
            return res.status(401).send({ error: 'Invalid credentials' });
        }

        // session
        req.session.user = {
            id: authUser.id,
            username: authUser.username,
            role: authUser.role,
        };
        
        // Explicitly save the session
        req.session.save((err) => {
            if (err) {
                console.error('Session save error:', err);
                return res.status(500).send({ error: 'Session save failed' });
            }
            res.status(200).send(authUser);
        });
        //---
    } catch (error) {
        console.error('Error during login:', error);
        res.status(500).send({ error: 'Login failed' });
    }
});

router.put('/roles/:role/permissions', requireLogin, requireRole('admin'), async (req, res) => {
    const role = (req.params.role || '').trim();
    const payload = req.body;
    if (!role) return res.status(400).send({ error: 'role path param is required' });
    if (!payload || !Array.isArray(payload.permissions)) {
        return res.status(400).send({ error: 'body must be { permissions: Permission[] }' });
    }

    // Basic validation
    const allowedMatchTypes = new Set(['prefix', 'exact']);
    const allowedMethods = new Set(['*','GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS']);
    const cleaned = [];
    for (const p of payload.permissions) {
        const method = String(p.method || '*').toUpperCase();
        const path_pattern = String(p.path_pattern || '/');
        const match_type = String(p.match_type || 'prefix');
        const allow = Boolean(p.allow !== false);
        const rate_limit_max = Number.isFinite(p.rate_limit_max) ? Math.max(0, Math.floor(p.rate_limit_max)) : 0;
        const rate_limit_window_ms = Number.isFinite(p.rate_limit_window_ms) ? Math.max(0, Math.floor(p.rate_limit_window_ms)) : 0;
        if (!allowedMethods.has(method)) {
            return res.status(400).send({ error: `Invalid method: ${method}` });
        }
        if (!allowedMatchTypes.has(match_type)) {
            return res.status(400).send({ error: `Invalid match_type: ${match_type}` });
        }
        if (!path_pattern.startsWith('/')) {
            return res.status(400).send({ error: `path_pattern must start with '/': ${path_pattern}` });
        }
        if (path_pattern.length > 2048) {
            return res.status(400).send({ error: 'path_pattern too long' });
        }
        cleaned.push({ method, path_pattern, match_type, allow, rate_limit_max, rate_limit_window_ms });
    }

    const pgClient = new Client(options);
    try {
        await pgClient.connect();
        await pgClient.query('BEGIN');
        await pgClient.query('INSERT INTO roles(name) VALUES($1) ON CONFLICT (name) DO NOTHING', [role]);
        await pgClient.query('DELETE FROM permissions WHERE role = $1', [role]);
        for (const p of cleaned) {
            await pgClient.query(
                `INSERT INTO permissions(role, method, path_pattern, match_type, allow, rate_limit_max, rate_limit_window_ms)
                 VALUES ($1,$2,$3,$4,$5,$6,$7)
                 ON CONFLICT (role, method, path_pattern, match_type) DO UPDATE
                 SET allow = EXCLUDED.allow,
                     rate_limit_max = EXCLUDED.rate_limit_max,
                     rate_limit_window_ms = EXCLUDED.rate_limit_window_ms`,
                [role, p.method, p.path_pattern, p.match_type, p.allow, p.rate_limit_max, p.rate_limit_window_ms]
            );
        }
        await pgClient.query('COMMIT');
        // Return current set
        const { rows } = await pgClient.query(
            `SELECT role, method, path_pattern, match_type, allow, rate_limit_max, rate_limit_window_ms
             FROM permissions WHERE role=$1 ORDER BY path_pattern, method`,
            [role]
        );
        res.status(200).send({ role, permissions: rows });
    } catch (error) {
        try { await pgClient.query('ROLLBACK'); } catch(e) {}
        console.error('Error updating permissions:', error);
        res.status(500).send({ error: 'Failed to update permissions' });
    } finally {
        await pgClient.end();
    }
});

router.post('/logout', (req, res) => {
    req.session.destroy(err => {
      if (err) return res.status(500).send({ error: 'Logout failed' });
      res.clearCookie('connect.sid'); 
      res.status(200).send({ message: 'Logged out' });
    });
  });

router.get('/me', requireLogin, async (req, res) => {
    try {
        const pgClient = new Client(options);
        await pgClient.connect();
        const result = await pgClient.query(
            'SELECT id, username, role, created_at FROM users WHERE id = $1 LIMIT 1',
            [req.session.user.id]
        );
        await pgClient.end();

        if (result.rows.length === 0) {
            return res.status(404).send({ error: 'User not found' });
        }

        res.status(200).send(result.rows[0]);
    } catch (error) {
        console.error('Error fetching current user:', error);
        res.status(500).send({ error: 'Internal server error' });
    }
});

router.put('/:id/role', requireLogin, requireRole('admin'), async (req, res) => {
    const userId = parseInt(req.params.id);
    const { role } = req.body || {};
    if (!userId || !role) {
        return res.status(400).send({ error: 'id param and role body field are required' });
    }
    const pgClient = new Client(options);
    try {
        await pgClient.connect();
        await pgClient.query('BEGIN');
        await pgClient.query('INSERT INTO roles(name) VALUES($1) ON CONFLICT (name) DO NOTHING', [role]);
        const result = await pgClient.query(
            'UPDATE users SET role = $1 WHERE id = $2 RETURNING id, username, role, created_at',
            [role, userId]
        );
        await pgClient.query('COMMIT');
        if (result.rows.length === 0) return res.status(404).send({ error: 'User not found' });
        res.status(200).send(result.rows[0]);
    } catch (error) {
        try { await pgClient.query('ROLLBACK'); } catch(e) {}
        console.error('Error updating user role:', error);
        res.status(500).send({ error: 'Failed to update user role' });
    } finally {
        await pgClient.end();
    }
});

export default router;