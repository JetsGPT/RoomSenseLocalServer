import { Point } from '@influxdata/influxdb-client';
import { influxClient, organisation, bucket } from './influxClient.js';

// Helper function to write sensor data
export function writeSensorData(sensor_box, sensor_type, value) {
    let writeClient = influxClient.getWriteApi(organisation, bucket, 'ns');
    
    let point = new Point('sensor_data')
        .tag('sensor_box', sensor_box)
        .tag('sensor_type', sensor_type)
        .floatField('value', parseFloat(value))
        .timestamp(new Date());

    writeClient.writePoint(point);
    writeClient.flush();
}

// Helper function to write test data
export function writeTestData() {
    let writeClient = influxClient.getWriteApi(organisation, bucket, 'ns');
    
    const sensorBoxes = ['box_001', 'box_002', 'box_003'];
    const sensorTypes = ['temperature', 'humidity', 'pressure', 'light'];
    
   
    const now = new Date();
    const sixMonthsAgo = new Date(now.getTime() - (6 * 30 * 24 * 60 * 60 * 1000)); // 6 months in milliseconds
    const timeRange = now.getTime() - sixMonthsAgo.getTime();
    
    for (let i = 0; i < 20; i++) {
        const sensorBox = sensorBoxes[Math.floor(Math.random() * sensorBoxes.length)];
        const sensorType = sensorTypes[Math.floor(Math.random() * sensorTypes.length)];
        const value = Math.random() * 100; // Random value between 0-100
        
        // Generate random timestamp within the last 6 months
        const randomTime = new Date(sixMonthsAgo.getTime() + Math.random() * timeRange);
        
        let point = new Point('sensor_data')
            .tag('sensor_box', sensorBox)
            .tag('sensor_type', sensorType)
            .floatField('value', value)
            .timestamp(randomTime);

        writeClient.writePoint(point);
    }
    
    writeClient.flush();
}

// Helper function to build Flux queries
export function buildFluxQuery(baseQuery, filters = {}) {
    let query = baseQuery;
    
    if (filters.sensor_box) {
        query += ` |> filter(fn: (r) => r.sensor_box == "${filters.sensor_box}")`;
    }
    
    if (filters.sensor_type) {
        query += ` |> filter(fn: (r) => r.sensor_type == "${filters.sensor_type}")`;
    }
    
    if (filters.limit) {
        query += ` |> limit(n: ${parseInt(filters.limit)})`;
    }
    
    return query;
}

// Helper function to format sensor data response
export function formatSensorData(tableObject) {
    return {
        timestamp: tableObject._time,
        sensor_box: tableObject.sensor_box,
        sensor_type: tableObject.sensor_type,
        value: tableObject._value
    };
}
