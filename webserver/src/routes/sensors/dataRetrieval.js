import express from 'express';
import { requireLogin } from '../../auth/auth.js';
import { influxClient, organisation, bucket } from './influxClient.js';
import {
    buildSecureFluxQuery,
    formatSensorData,
    sanitizeSensorBox,
    sanitizeSensorType,
    sanitizeFluxTime,
    sanitizeLimit
} from './utils.js';

const router = express.Router();

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Logs security warnings for potential injection attempts
 */
function logSecurityWarning(req, field, value, reason) {
    const user = req.session?.user?.username || 'anonymous';
    const ip = req.ip || 'unknown';
    console.warn(
        `[SECURITY] Potential injection attempt detected - User: ${user}, IP: ${ip}, ` +
        `Field: ${field}, Value: ${JSON.stringify(value)}, Reason: ${reason}`
    );
}

/**
 * Executes a Flux query and returns formatted results
 */
function executeQuery(fluxQuery, res, successMessage) {
    const data = [];
    const queryClient = influxClient.getQueryApi(organisation);

    queryClient.queryRows(fluxQuery, {
        next: (row, tableMeta) => {
            const tableObject = tableMeta.toObject(row);
            data.push(formatSensorData(tableObject));
        },
        error: (error) => {
            console.error(`Query execution failed: ${error.message}`);
            res.status(500).json({ error: 'Error getting data.' });
        },
        complete: () => {
            res.status(200).json(data);
            if (successMessage) {
                console.log(successMessage);
            }
        },
    });
}

/**
 * Validates and sanitizes query parameters
 */
function sanitizeQueryParams(req) {
    const { sensor_box, sensor_type, start_time, end_time, limit, sort } = req.query;

    const sanitized = {
        sensor_box: sensor_box ? sanitizeSensorBox(sensor_box) : null,
        sensor_type: sensor_type ? sanitizeSensorType(sensor_type) : null,
        start_time: sanitizeFluxTime(start_time, '-24h'),
        end_time: sanitizeFluxTime(end_time, 'now()'),
        limit: sanitizeLimit(limit),
        sort: sort === 'desc' || sort === 'asc' ? sort : null
    };

    // Log security warnings for rejected inputs
    if (sensor_box && !sanitized.sensor_box) {
        logSecurityWarning(req, 'sensor_box', sensor_box, 'Invalid characters or format');
    }
    if (sensor_type && !sanitized.sensor_type) {
        logSecurityWarning(req, 'sensor_type', sensor_type, 'Invalid characters or format');
    }
    if (start_time && sanitized.start_time === '-24h' && start_time !== '-24h') {
        logSecurityWarning(req, 'start_time', start_time, 'Invalid time format - using default');
    }
    if (end_time && sanitized.end_time === 'now()' && end_time !== 'now()') {
        logSecurityWarning(req, 'end_time', end_time, 'Invalid time format - using default');
    }

    return sanitized;
}

// ============================================================================
// Data Retrieval Endpoints
// ============================================================================

/**
 * GET /api/sensors/data
 * Get all sensor data with optional filtering
 */
router.get('/data', requireLogin, (req, res) => {
    console.log('A read attempt has been made');

    const sanitized = sanitizeQueryParams(req);

    const fluxQuery = buildSecureFluxQuery(bucket, sanitized);
    executeQuery(fluxQuery, res, 'A read attempt has succeeded');
});

/**
 * GET /api/sensors/data/box/:sensor_box
 * Get data filtered by sensor box
 */
router.get('/data/box/:sensor_box', requireLogin, async (req, res) => {
    const { sensor_box } = req.params;
    const { sensor_type, start_time, end_time, limit, sort } = req.query;

    const sanitizedBox = sanitizeSensorBox(sensor_box);
    if (!sanitizedBox) {
        logSecurityWarning(req, 'sensor_box', sensor_box, 'Invalid characters or format');
        return res.status(400).json({
            error: 'Invalid sensor_box format',
            detail: 'sensor_box must contain only alphanumeric characters, underscores, hyphens, and dots'
        });
    }

    // Sanitize optional query parameters
    const sanitizedType = sensor_type ? sanitizeSensorType(sensor_type) : null;
    const sanitizedStart = sanitizeFluxTime(start_time, '-24h');
    const sanitizedEnd = sanitizeFluxTime(end_time, 'now()');
    const sanitizedLimit = sanitizeLimit(limit);
    const sanitizedSort = sort === 'desc' || sort === 'asc' ? sort : null;

    if (sensor_type && !sanitizedType) {
        logSecurityWarning(req, 'sensor_type', sensor_type, 'Invalid characters or format');
    }

    // Resolve display_name to technical name if possible
    let technicalName = sanitizedBox;
    const pool = req.app.locals.pool;

    if (pool) {
        try {
            // Check if the provided box name is actually a display name
            const result = await pool.query(
                'SELECT name FROM ble_connections WHERE display_name = $1',
                [sanitizedBox]
            );
            if (result.rows.length > 0 && result.rows[0].name) {
                technicalName = result.rows[0].name;
                console.log(`Resolved alias '${sanitizedBox}' to technical ID '${technicalName}'`);
            }
        } catch (dbError) {
            console.error('Error resolving sensor box alias:', dbError);
        }
    }

    console.log(`Getting data for sensor box: ${technicalName} (requested: ${sanitizedBox})`);

    const fluxQuery = buildSecureFluxQuery(bucket, {
        sensor_box: technicalName,
        sensor_type: sanitizedType,
        start_time: sanitizedStart,
        end_time: sanitizedEnd,
        limit: sanitizedLimit,
        sort: sanitizedSort
    });

    executeQuery(fluxQuery, res, `Data retrieved for sensor box: ${technicalName}`);
});

/**
 * GET /api/sensors/data/type/:sensor_type
 * Get data filtered by sensor type
 */
router.get('/data/type/:sensor_type', requireLogin, (req, res) => {
    const { sensor_type } = req.params;
    const { sensor_box, start_time, end_time, limit, sort } = req.query;

    // Validate required path parameter
    const sanitizedType = sanitizeSensorType(sensor_type);
    if (!sanitizedType) {
        logSecurityWarning(req, 'sensor_type', sensor_type, 'Invalid characters or format');
        return res.status(400).json({
            error: 'Invalid sensor_type format',
            detail: 'sensor_type must contain only alphanumeric characters, underscores, hyphens, and dots'
        });
    }

    // Sanitize optional query parameters
    const sanitizedBox = sensor_box ? sanitizeSensorBox(sensor_box) : null;
    const sanitizedStart = sanitizeFluxTime(start_time, '-24h');
    const sanitizedEnd = sanitizeFluxTime(end_time, 'now()');
    const sanitizedLimit = sanitizeLimit(limit);
    const sanitizedSort = sort === 'desc' || sort === 'asc' ? sort : null;

    if (sensor_box && !sanitizedBox) {
        logSecurityWarning(req, 'sensor_box', sensor_box, 'Invalid characters or format');
    }

    console.log(`Getting data for sensor type: ${sanitizedType}`);

    const fluxQuery = buildSecureFluxQuery(bucket, {
        sensor_box: sanitizedBox,
        sensor_type: sanitizedType,
        start_time: sanitizedStart,
        end_time: sanitizedEnd,
        limit: sanitizedLimit,
        sort: sanitizedSort
    });

    executeQuery(fluxQuery, res, `Data retrieved for sensor type: ${sanitizedType}`);
});

/**
 * GET /api/sensors/data/aggregated/:sensor_box/:sensor_type
 * Get aggregated sensor data (e.g. daily mean) for heatmaps
 */
router.get('/data/aggregated/:sensor_box/:sensor_type', requireLogin, async (req, res) => {
    const { sensor_box, sensor_type } = req.params;
    const { start_time, end_time, aggregation } = req.query;

    // Validate required path param
    const sanitizedBox = sanitizeSensorBox(sensor_box);
    const sanitizedType = sanitizeSensorType(sensor_type);

    if (!sanitizedBox || !sanitizedType) {
        return res.status(400).json({ error: 'Invalid sensor_box or sensor_type format' });
    }

    const sanitizedStart = sanitizeFluxTime(start_time, '-365d'); // Default to 1 year
    const sanitizedEnd = sanitizeFluxTime(end_time, 'now()');

    // Whitelist aggregation function
    const validAggregations = ['mean', 'min', 'max', 'sum', 'count'];
    const sanitizedAggregation = validAggregations.includes(aggregation) ? aggregation : 'mean';

    // Resolve aliases
    let technicalName = sanitizedBox;
    const pool = req.app.locals.pool;
    if (pool) {
        try {
            const result = await pool.query(
                'SELECT name FROM ble_connections WHERE display_name = $1',
                [sanitizedBox]
            );
            if (result.rows.length > 0 && result.rows[0].name) {
                technicalName = result.rows[0].name;
            }
        } catch (e) { console.error('Error resolving alias', e); }
    }

    console.log(`Getting aggregated (${sanitizedAggregation}) data for ${technicalName}:${sanitizedType}`);

    const escapedBucket = bucket.replace(/"/g, '\\"');
    const escapedBox = technicalName.replace(/"/g, '\\"');
    const escapedType = sanitizedType.replace(/"/g, '\\"');

    // Flux query with daily window
    const fluxQuery = `from(bucket: "${escapedBucket}")
  |> range(start: ${sanitizedStart}, stop: ${sanitizedEnd})
  |> filter(fn: (r) => r._measurement == "sensor_data")
  |> filter(fn: (r) => r.sensor_box == "${escapedBox}")
  |> filter(fn: (r) => r.sensor_type == "${escapedType}")
  |> aggregateWindow(every: 1d, fn: ${sanitizedAggregation}, createEmpty: false)
  |> yield(name: "${sanitizedAggregation}")`;

    const data = [];
    const queryClient = influxClient.getQueryApi(organisation);

    queryClient.queryRows(fluxQuery, {
        next: (row, tableMeta) => {
            const o = tableMeta.toObject(row);
            // Format specifically for frontend graph expectation { date, value }
            data.push({
                date: o._time,
                value: o._value
            });
        },
        error: (error) => {
            console.error('Aggregation query failed:', error);
            res.status(500).json({ error: 'Failed to fetch aggregated data' });
        },
        complete: () => {
            res.json(data);
        }
    });
});

/**
 * GET /api/sensors/boxes
 * Get unique sensor boxes
 */
router.get('/boxes', requireLogin, (req, res) => {
    console.log('Getting unique sensor boxes');

    const boxes = new Set();
    const queryClient = influxClient.getQueryApi(organisation);

    // Build secure query (no user input, but still use secure method)
    const fluxQuery = buildSecureFluxQuery(bucket, {
        start_time: '-30d',
        end_time: 'now()',
        limit: 10000 // Large limit to get all unique values
    }) + `
 |> keep(columns: ["sensor_box"])
 |> distinct(column: "sensor_box")`;

    queryClient.queryRows(fluxQuery, {
        next: (row, tableMeta) => {
            const tableObject = tableMeta.toObject(row);
            if (tableObject.sensor_box) {
                // Additional sanitization on output for safety
                const sanitized = sanitizeSensorBox(tableObject.sensor_box);
                if (sanitized) {
                    boxes.add(sanitized);
                }
            }
        },
        error: (error) => {
            console.error('Error getting sensor boxes:', error);
            res.status(500).json({ error: 'Error getting sensor boxes.' });
        },
        complete: () => {
            res.status(200).json(Array.from(boxes));
            console.log('Sensor boxes retrieved successfully');
        },
    });
});

/**
 * GET /api/sensors/types
 * Get unique sensor types
 */
router.get('/types', requireLogin, (req, res) => {
    console.log('Getting unique sensor types');

    const types = new Set();
    const queryClient = influxClient.getQueryApi(organisation);

    // Build secure query (no user input, but still use secure method)
    const fluxQuery = buildSecureFluxQuery(bucket, {
        start_time: '-30d',
        end_time: 'now()',
        limit: 10000 // Large limit to get all unique values
    }) + `
 |> keep(columns: ["sensor_type"])
 |> distinct(column: "sensor_type")`;

    queryClient.queryRows(fluxQuery, {
        next: (row, tableMeta) => {
            const tableObject = tableMeta.toObject(row);
            if (tableObject.sensor_type) {
                // Additional sanitization on output for safety
                const sanitized = sanitizeSensorType(tableObject.sensor_type);
                if (sanitized) {
                    types.add(sanitized);
                }
            }
        },
        error: (error) => {
            console.error('Error getting sensor types:', error);
            res.status(500).json({ error: 'Error getting sensor types.' });
        },
        complete: () => {
            res.status(200).json(Array.from(types));
            console.log('Sensor types retrieved successfully');
        },
    });
});

/**
 * GET /api/sensors/data/export/csv
 * Export sensor data as CSV with optional filtering
 */
router.get('/data/export/csv', requireLogin, (req, res) => {
    console.log('CSV export requested');

    const sanitized = sanitizeQueryParams(req);
    const fluxQuery = buildSecureFluxQuery(bucket, sanitized);

    const data = [];
    const queryClient = influxClient.getQueryApi(organisation);

    queryClient.queryRows(fluxQuery, {
        next: (row, tableMeta) => {
            const tableObject = tableMeta.toObject(row);
            data.push(formatSensorData(tableObject));
        },
        error: (error) => {
            console.error(`CSV export query failed: ${error.message}`);
            res.status(500).json({ error: 'Error exporting data.' });
        },
        complete: () => {
            // Convert to CSV
            if (data.length === 0) {
                res.status(200).send('timestamp,sensor_box,sensor_type,value\n');
                return;
            }

            // CSV header
            const headers = ['timestamp', 'sensor_box', 'sensor_type', 'value'];
            const csvHeader = headers.join(',') + '\n';

            // CSV rows
            const csvRows = data.map(row => {
                return headers.map(header => {
                    const value = row[header];
                    // Escape values that contain commas or quotes
                    if (typeof value === 'string' && (value.includes(',') || value.includes('"') || value.includes('\n'))) {
                        return `"${value.replace(/"/g, '""')}"`;
                    }
                    return value;
                }).join(',');
            }).join('\n');

            const csv = csvHeader + csvRows;

            // Set headers for file download
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="sensor_data_${Date.now()}.csv"`);
            res.status(200).send(csv);
            console.log(`CSV export successful: ${data.length} rows`);
        },
    });
});

export default router;
