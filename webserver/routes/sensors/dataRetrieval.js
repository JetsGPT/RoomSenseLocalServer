import express from 'express';
import { requireLogin } from '../../auth/auth.js';
import { influxClient, organisation, bucket } from './influxClient.js';
import { buildFluxQuery, formatSensorData } from './utils.js';

const router = express.Router();

// Get all sensor data with optional filtering
router.get('/data', requireLogin, (req, res) => {
    const { sensor_box, sensor_type, start_time, end_time, limit } = req.query;
    
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

export default router;
