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
    });
})


async function createUser(username, password, role) {
    const pgClient = new Client(options);
    try {
        const insertString = username + ', ' + Date.now() + ", " + role + ", " +  password;
        await pgClient.connect();
        const result = await pgClient.query(
            'INSERT INTO users (username, password, created_at) VALUES ($1, $2, NOW()) RETURNING *',
            [username, password],
        );
        console.log(result)
        return result
    } catch (error) {
        console.error('Error fetching users:', error);
    } finally {
        await pgClient.end();
    }
}

async function fetchUsers() {
    const pgClient = new Client(options);
    try {
        await pgClient.connect();
        const result = await pgClient.query('SELECT * FROM users');
        const users = result.rows;
        console.log(users);
        return users;
    } catch (error) {
        console.error('Error fetching users:', error);
    } finally {
        await pgClient.end();
    }
}

export default router;