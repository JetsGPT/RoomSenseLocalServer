// Import the HTTP module using ESM syntax
import pg from 'pg'

import express from 'express';
import axios from 'axios';

const app = express();
const PORT = 3000;

// Middleware to parse JSON request bodies
app.use(express.json());

// Home Route
app.get('/', (req, res) => {
    res.send('Welcome to the Axios Node.js Server with ESM!');
});

// GET: Fetching data from an external API
app.get('/api/posts', async (req, res) => {
    try {
        const response = await axios.get('https://jsonplaceholder.typicode.com/posts');
        res.json(response.data);
    } catch (error) {
        console.error('Error fetching posts:', error);
        res.status(500).send('Error fetching data.');
    }
});

// POST: Sending data to an external API
app.post('/api/create', async (req, res) => {
    try {
        const { title, body, userId } = req.body;
        const response = await axios.post('https://jsonplaceholder.typicode.com/posts', {
            title,
            body,
            userId,
        });
        res.json(response.data);
    } catch (error) {
        console.error('Error creating post:', error);
        res.status(500).send('Error creating data.');
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
});

/*
const {InfluxDB, Point} = require('@influxdata/influxdb-client')

const token = ''
const url = 'http://localhost:8086'

const client = new InfluxDB({url, token})

let org = `testing`
let bucket = `temperature`

let writeClient = client.getWriteApi(org, bucket, 'ns')

for (let i = 0; i < 5; i++) {
    let point = new Point('measurement1')
        .tag('tagname1', 'tagvalue1')
        .intField('field1', i)

    void setTimeout(() => {
        writeClient.writePoint(point)
    }, i * 1000) // separate points by 1 second

    void setTimeout(() => {
        writeClient.flush()
    }, 5000)
}
*/
/*
const { Client } = pg
const client = new Client({
    user: 'postgres',
    password: 'Passw0rd',
    host: 'localhost',
    port: 8087,
    database: 'postgres',
})
await client.connect()

const res = await client.query('SELECT $1::text as message', ['Hello world!'])
console.log(res.rows[0].message) // Hello world!
await client.end()
*/
