import express from 'express';
import { requireLogin } from '../../auth/auth.js';
import { influxClient, organisation, bucket } from './influxClient.js';
import { buildFluxQuery, formatSensorData } from './utils.js';

const router = express.Router();

function generateMockData(box, type, start) {
    const data = [];
    const now = Date.now();
    const startTime = start ? new Date(now - 24 * 60 * 60 * 1000).getTime() : new Date(now - 24 * 60 * 60 * 1000).getTime();
    const steps = 24 * 4; // 15 min intervals
    const interval = (now - startTime) / steps;

    const boxes = box ? [box] : ['living_room', 'bedroom'];
    const types = type ? [type] : ['temperature', 'humidity', 'co2'];

    for (const b of boxes) {
        for (const t of types) {
            for (let i = 0; i <= steps; i++) {
                const time = new Date(startTime + i * interval).toISOString();
                let value = 20;
                if (t === 'temperature') value = 20 + Math.sin(i / 10) * 5 + (Math.random() - 0.5);
                if (t === 'humidity') value = 50 + Math.cos(i / 10) * 10 + (Math.random() - 0.5) * 5;
                if (t === 'co2') value = 800 + Math.random() * 200;

                data.push({
                    _time: time,
                    _value: parseFloat(value.toFixed(2)),
                    sensor_type: t,
                    sensor_box: b,
                    _field: 'value'
                });
            }
        }
    }
    return data;
}

// Get all sensor data with optional filtering
router.get('/data', requireLogin, (req, res) => {
    const { sensor_box, sensor_type, start_time, end_time, limit } = req.query;

    if (process.env.DEMO_MODE === 'true') {
        const mockData = generateMockData(sensor_box, sensor_type, start_time);
        return res.status(200).json(mockData);
    }

    console.log("A read attempt has been made");
    let data = [];
    let queryClient = influxClient.getQueryApi(organisation);

    // Build dynamic query using utility function
    const baseQuery = `from(bucket: "${bucket}")
 |> range(start: ${start_time || '-24h'}, stop: ${end_time || 'now()'})
 |> filter(fn: (r) => r._measurement == "sensor_data")`;

    const fluxQuery = buildFluxQuery(baseQuery, { sensor_box, sensor_type, limit });

    queryClient.queryRows(fluxQuery, {
        next: (row, tableMeta) => {
            const tableObject = tableMeta.toObject(row);
            data.push(formatSensorData(tableObject));
        },
        error: (error) => {
            console.error("A read attempt has failed:", error);
            res.status(500).json({ error: 'Error getting data.' });
        },
        complete: () => {
            res.status(200).json(data);
            console.log("A read attempt has succeeded");
        },
    });
});

// Get data by sensor box
router.get('/data/box/:sensor_box', requireLogin, (req, res) => {
    const { sensor_box } = req.params;
    const { sensor_type, start_time, end_time, limit } = req.query;

    console.log(`Getting data for sensor box: ${sensor_box}`);
    let data = [];
    let queryClient = influxClient.getQueryApi(organisation);

    const baseQuery = `from(bucket: "${bucket}")
 |> range(start: ${start_time || '-24h'}, stop: ${end_time || 'now()'})
 |> filter(fn: (r) => r._measurement == "sensor_data")
 |> filter(fn: (r) => r.sensor_box == "${sensor_box}")`;

    const fluxQuery = buildFluxQuery(baseQuery, { sensor_type, limit });

    queryClient.queryRows(fluxQuery, {
        next: (row, tableMeta) => {
            const tableObject = tableMeta.toObject(row);
            data.push(formatSensorData(tableObject));
        },
        error: (error) => {
            console.error("Error getting sensor box data:", error);
            res.status(500).json({ error: 'Error getting data.' });
        },
        complete: () => {
            res.status(200).json(data);
            console.log(`Data retrieved for sensor box: ${sensor_box}`);
        },
    });
});

// Get data by sensor type
router.get('/data/type/:sensor_type', requireLogin, (req, res) => {
    const { sensor_type } = req.params;
    const { sensor_box, start_time, end_time, limit } = req.query;

    console.log(`Getting data for sensor type: ${sensor_type}`);
    let data = [];
    let queryClient = influxClient.getQueryApi(organisation);

    const baseQuery = `from(bucket: "${bucket}")
 |> range(start: ${start_time || '-24h'}, stop: ${end_time || 'now()'})
 |> filter(fn: (r) => r._measurement == "sensor_data")
 |> filter(fn: (r) => r.sensor_type == "${sensor_type}")`;

    const fluxQuery = buildFluxQuery(baseQuery, { sensor_box, limit });

    queryClient.queryRows(fluxQuery, {
        next: (row, tableMeta) => {
            const tableObject = tableMeta.toObject(row);
            data.push(formatSensorData(tableObject));
        },
        error: (error) => {
            console.error("Error getting sensor type data:", error);
            res.status(500).json({ error: 'Error getting data.' });
        },
        complete: () => {
            res.status(200).json(data);
            console.log(`Data retrieved for sensor type: ${sensor_type}`);
        },
    });
});

// Get unique sensor boxes
router.get('/boxes', requireLogin, (req, res) => {
    console.log("Getting unique sensor boxes");

    if (process.env.DEMO_MODE === 'true') {
        return res.status(200).json(['living_room', 'bedroom']);
    }

    let boxes = new Set();
    let queryClient = influxClient.getQueryApi(organisation);

    let fluxQuery = `from(bucket: "${bucket}")
 |> range(start: -30d)
 |> filter(fn: (r) => r._measurement == "sensor_data")
 |> keep(columns: ["sensor_box"])
 |> distinct(column: "sensor_box")`;

    queryClient.queryRows(fluxQuery, {
        next: (row, tableMeta) => {
            const tableObject = tableMeta.toObject(row);
            if (tableObject.sensor_box) {
                boxes.add(tableObject.sensor_box);
            }
        },
        error: (error) => {
            console.error("Error getting sensor boxes:", error);
            res.status(500).json({ error: 'Error getting sensor boxes.' });
        },
        complete: () => {
            res.status(200).json(Array.from(boxes));
            console.log("Sensor boxes retrieved successfully");
        },
    });
});

// Get unique sensor types
router.get('/types', requireLogin, (req, res) => {
    console.log("Getting unique sensor types");

    if (process.env.DEMO_MODE === 'true') {
        return res.status(200).json(['temperature', 'humidity', 'co2']);
    }

    let types = new Set();
    let queryClient = influxClient.getQueryApi(organisation);

    let fluxQuery = `from(bucket: "${bucket}")
 |> range(start: -30d)
 |> filter(fn: (r) => r._measurement == "sensor_data")
 |> keep(columns: ["sensor_type"])
 |> distinct(column: "sensor_type")`;

    queryClient.queryRows(fluxQuery, {
        next: (row, tableMeta) => {
            const tableObject = tableMeta.toObject(row);
            if (tableObject.sensor_type) {
                types.add(tableObject.sensor_type);
            }
        },
        error: (error) => {
            console.error("Error getting sensor types:", error);
            res.status(500).json({ error: 'Error getting sensor types.' });
        },
        complete: () => {
            res.status(200).json(Array.from(types));
            console.log("Sensor types retrieved successfully");
        },
    });
});

// Get aggregated daily data for heatmap visualization
router.get('/data/aggregated/:sensor_box/:sensor_type', requireLogin, (req, res) => {
    const { sensor_box, sensor_type } = req.params;
    const { start_time = '-365d', end_time = 'now()', aggregation = 'mean' } = req.query;

    console.log(`Getting aggregated data for ${sensor_box}/${sensor_type}`);

    // DEMO MODE: Generate mock aggregated data
    if (process.env.DEMO_MODE === 'true') {
        const mockData = [];
        const now = new Date();
        for (let i = 364; i >= 0; i--) {
            const date = new Date(now);
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];

            // Generate realistic values based on sensor type
            let value;
            if (sensor_type === 'temperature') {
                value = 18 + Math.sin((364 - i) / 30) * 8 + (Math.random() - 0.5) * 3;
            } else if (sensor_type === 'humidity') {
                value = 50 + Math.cos((364 - i) / 40) * 20 + (Math.random() - 0.5) * 10;
            } else if (sensor_type === 'co2') {
                value = 600 + Math.random() * 400;
            } else {
                value = 50 + Math.random() * 50;
            }

            // ~10% chance of missing data for realism
            if (Math.random() > 0.1) {
                mockData.push({ date: dateStr, value: parseFloat(value.toFixed(2)) });
            }
        }
        return res.status(200).json(mockData);
    }

    // Map aggregation parameter to Flux function
    const aggFunctions = { mean: 'mean', max: 'max', min: 'min', count: 'count' };
    const aggFn = aggFunctions[aggregation] || 'mean';

    let data = [];
    let queryClient = influxClient.getQueryApi(organisation);

    const fluxQuery = `from(bucket: "${bucket}")
  |> range(start: ${start_time}, stop: ${end_time})
  |> filter(fn: (r) => r._measurement == "sensor_data")
  |> filter(fn: (r) => r.sensor_box == "${sensor_box}")
  |> filter(fn: (r) => r.sensor_type == "${sensor_type}")
  |> aggregateWindow(every: 1d, fn: ${aggFn}, createEmpty: false)
  |> yield(name: "daily_aggregated")`;

    queryClient.queryRows(fluxQuery, {
        next: (row, tableMeta) => {
            const tableObject = tableMeta.toObject(row);
            const date = new Date(tableObject._time).toISOString().split('T')[0];
            data.push({
                date,
                value: parseFloat(tableObject._value?.toFixed(2) ?? 0)
            });
        },
        error: (error) => {
            console.error("Error getting aggregated data:", error);
            res.status(500).json({ error: 'Error getting aggregated data.' });
        },
        complete: () => {
            res.status(200).json(data);
            console.log(`Aggregated data retrieved: ${data.length} days`);
        },
    });
});

export default router;
