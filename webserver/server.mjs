// Import the HTTP module using ESM syntax
import pg from 'pg'
import express from 'express';
import { InfluxDB, Point } from '@influxdata/influxdb-client';
import cors from 'cors';

const app = express();
const PORT = 3000;

const token = 'TR6vWva87Bs1YGnAEQlR2gmO-inil9P_rUqNMhS1GQfgo97zBAapEx9_S4vOIwRKS6LS82vNWPpej6alqpGX-A=='
const url = 'http://localhost:8086'

const influxClient = new InfluxDB({url, token})

const { Client } = pg
const options = {
    user: 'postgres',
    password: 'Passw0rd',
    host: 'localhost',
    port: 5555,
    database: 'postgres',
}


// Middleware to parse JSON request bodies
app.use(express.json());
app.use(cors())

app.get('/', (req, res) => {
    console.log("mama")
    res.send('Hello, World!');
});

app.get('/sensor/data', (req, res) => {
    console.log("A read attempt has been made");
    let response = '';  // Initialize as an empty string
    let org = `RoomSense`;
    let queryClient = influxClient.getQueryApi(org);
    let fluxQuery = `from(bucket: "Temp")
 |> range(start: -10m)
 |> filter(fn: (r) => r._measurement == "measurement1")`;

    queryClient.queryRows(fluxQuery, {
        next: (row, tableMeta) => {
            const tableObject = tableMeta.toObject(row);
            response += JSON.stringify(tableObject); // Append JSON string with a newline
        },
        error: (error) => {
            res.status(500).send('Error getting data.');
            console.log("A read attempt has failed");
        },
        complete: () => {
            res.status(200).json(response || 'No data found'); // Prevent empty response
            console.log("A read attempt has succeeded")
        },
    });
});


app.get('/user/all', async (req, res) => {
    fetchUsers().then(users => {
        console.log('Fetched Users:', users);
        res.status(200).send(users)
    });
})

app.post('/user/register', async (req, res) => {
    let {user, password} = req.body;
    createUser(user, password).then(result => {
        console.log('Created user: ', result);
        res.status(200).send(result)
    });
})

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

async function createUser(username, password) {
    const pgClient = new Client(options);
    try {
        const insertString = username + ', ' + Date.now() + ", " + 'admin, ' + password;
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

function writeTestData(){
    let org = `RoomSense`
    let bucket = `Temp`

    let writeClient = influxClient.getWriteApi(org, bucket, 'ns')

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
}

// writeTestData();

// Start the server
app.listen(PORT, () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
});