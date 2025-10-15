import express from 'express';
import { requireLogin } from '../../auth/auth.js';
import { influxClient, organisation, bucket } from './influxClient.js';
import { writeSensorData, writeTestData } from './utils.js';

const router = express.Router();

// Write sensor data
router.post('/data', requireLogin, (req, res) => {
    const { sensor_box, sensor_type, value } = req.body;
    
    if (!sensor_box || !sensor_type || value === undefined) {
        return res.status(400).json({ error: 'sensor_box, sensor_type, and value are required' });
    }
    
    try {
        writeSensorData(sensor_box, sensor_type, value);
        res.status(200).json({ message: 'Sensor data written successfully' });
    } catch (error) {
        console.error('Error writing sensor data:', error);
        res.status(500).json({ error: 'Failed to write sensor data' });
    }
});

// Write test data
router.get('/writeTestData', requireLogin, (req, res) => {
    try {
        writeTestData();
        res.status(200).json({ message: 'Test data has been written.' });
    } catch (err) {
        console.error('Error writing test data:', err);
        res.status(500).json({ error: 'Failed to write test data' });
    }
});

export default router;
