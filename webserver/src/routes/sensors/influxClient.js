import { InfluxDB } from '@influxdata/influxdb-client';
import https from 'https';
import fs from 'fs';
import path from 'path';

// Read InfluxDB token directly from Docker secret file to ensure exact match with InfluxDB
// This avoids any potential issues with process.env or trimming
let token = process.env.INFLUX_TOKEN;
try {
  const secretPath = '/run/secrets/influx_token';
  if (fs.existsSync(secretPath)) {
    const secret = fs.readFileSync(secretPath, 'utf8')
      .replace(/\r\n/g, '')
      .replace(/\n/g, '')
      .replace(/\r/g, '');
    if (secret) {
      token = secret;
      console.log('✓ Using InfluxDB token from Docker secret file');
    }
  }
} catch (error) {
  console.warn(`⚠️  Could not read InfluxDB token secret file, using process.env.INFLUX_TOKEN: ${error.message}`);
}

// InfluxDB client configuration
const url = process.env.INFLUX_URL;
const organisation = process.env.INFLUX_ORG;
const bucket = process.env.INFLUX_BUCKET;

// Create secure HTTPS agent that validates the self-signed certificate
const httpsAgent = new https.Agent({
  // We trust the Root CA, which signed the InfluxDB cert
  ca: fs.readFileSync('/run/secrets/ssl_root_ca'),
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
