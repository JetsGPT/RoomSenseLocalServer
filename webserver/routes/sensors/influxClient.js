import { InfluxDB } from '@influxdata/influxdb-client';
import https from 'https';
import fs from 'fs';
import path from 'path';

// InfluxDB client configuration
const token = process.env.INFLUX_TOKEN;
const url = process.env.INFLUX_URL;
const organisation = process.env.INFLUX_ORG;
const bucket = process.env.INFLUX_BUCKET;

// Create secure HTTPS agent that validates the self-signed certificate
const httpsAgent = new https.Agent({
  ca: fs.readFileSync(path.join(process.cwd(), 'certs', 'influxdb-selfsigned.crt')),
  rejectUnauthorized: true // This ensures certificate validation
});

// Create and export InfluxDB client with secure HTTPS agent
const influxClient = new InfluxDB({ 
  url, 
  token,
  transportOptions: {
    agent: httpsAgent
  }
});

export { influxClient, organisation, bucket };
