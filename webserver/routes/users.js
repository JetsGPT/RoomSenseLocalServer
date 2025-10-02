import express from 'express';
import pg from 'pg'

const router = express.Router();

const { Client } = pg
const options = {
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'password',
    host: process.env.PGHOST || 'postgres',
    port: process.env.PGPORT ? parseInt(process.env.PGPORT) : 5432,
    database: process.env.PGDATABASE || 'user',
};


router.get('/all', async (req, res) => {
    fetchUsers().then(users => {
        console.log('Fetched Users:', users);
        res.status(200).send(users)
    });
})

router.post('/register', async (req, res) => {
    let {user, password, role} = req.body;
    createUser(user, password, role).then(result => {
        console.log('Created user: ', result);
        res.status(200).send(result)
    }).catch(err => {
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
        //---

        res.status(200).send(authUser);
    } catch (error) {
        console.error('Error during login:', error);
        res.status(500).send({ error: 'Login failed' });
    }
});


async function createUser(username, password, role) {
    const pgClient = new Client(options);
    try {
        await pgClient.connect();
        const result = await pgClient.query(
            'INSERT INTO users (username, password, role, created_at) VALUES ($1, $2, $3, NOW()) RETURNING id, username, role, created_at',
            [username, password, role]
        );
        return result.rows?.[0] ?? null;
    } catch (error) {
        console.error('Error creating user:', error);
        throw error;
    } finally {
        await pgClient.end();
    }
}

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

async function fetchUsers() {
    const pgClient = new Client(options);
    try {
        await pgClient.connect();
        const result = await pgClient.query('SELECT id, username, role, created_at, password FROM users ORDER BY id DESC');
        const users = result.rows;
        console.log(users);
        return users;
    } catch (error) {
        console.error('Error fetching users:', error);
        throw error;
    } finally {
        await pgClient.end();
    }
}

export default router;