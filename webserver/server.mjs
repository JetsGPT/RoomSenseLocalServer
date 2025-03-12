// Import the HTTP module using ESM syntax
import http from 'http';

const hostname = '127.0.0.1';
const port = 3000;

// Create the server
const server = http.createServer((req, res) => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain');
    res.end('Hello, World!\n');
});

// Start the server
server.listen(port, hostname, () => {
    console.log(`Server running at http://${hostname}:${port}/`);
});

repl.repl.ignoreUndefined=true

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