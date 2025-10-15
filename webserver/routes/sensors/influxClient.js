import { InfluxDB } from '@influxdata/influxdb-client';

// InfluxDB client configuration
const token = process.env.INFLUX_TOKEN;
const url = process.env.INFLUX_URL;
const organisation = process.env.INFLUX_ORG;
const bucket = process.env.INFLUX_BUCKET;

// Create and export InfluxDB client
const influxClient = new InfluxDB({ url, token });

export { influxClient, organisation, bucket };
