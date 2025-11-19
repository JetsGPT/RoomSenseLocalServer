import { Point } from '@influxdata/influxdb-client';
import { influxClient, organisation, bucket } from './influxClient.js';

// ============================================================================
// Constants
// ============================================================================

const MAX_LIMIT = 10000;
const MAX_STRING_LENGTH = 255;

// ============================================================================
// Data Writing Functions
// ============================================================================

/**
 * Writes sensor data to InfluxDB
 * @param {string} sensor_box - Sensor box identifier (should be pre-sanitized)
 * @param {string} sensor_type - Sensor type identifier (should be pre-sanitized)
 * @param {number} value - Sensor value
 */
export function writeSensorData(sensor_box, sensor_type, value) {
    const writeClient = influxClient.getWriteApi(organisation, bucket, 'ns');
    
    const point = new Point('sensor_data')
        .tag('sensor_box', sensor_box)
        .tag('sensor_type', sensor_type)
        .floatField('value', parseFloat(value))
        .timestamp(new Date());

    writeClient.writePoint(point);
    writeClient.flush();
}

/**
 * Writes test data to InfluxDB for development/testing purposes
 */
export function writeTestData() {
    const writeClient = influxClient.getWriteApi(organisation, bucket, 'ns');
    
    const sensorBoxes = ['box_001', 'box_002', 'box_003'];
    const sensorTypes = ['temperature', 'humidity', 'pressure', 'light'];
    
    const now = new Date();
    const sixMonthsAgo = new Date(now.getTime() - (6 * 30 * 24 * 60 * 60 * 1000));
    const timeRange = now.getTime() - sixMonthsAgo.getTime();
    
    for (let i = 0; i < 20; i++) {
        const sensorBox = sensorBoxes[Math.floor(Math.random() * sensorBoxes.length)];
        const sensorType = sensorTypes[Math.floor(Math.random() * sensorTypes.length)];
        const value = Math.random() * 100;
        
        const randomTime = new Date(sixMonthsAgo.getTime() + Math.random() * timeRange);
        
        const point = new Point('sensor_data')
            .tag('sensor_box', sensorBox)
            .tag('sensor_type', sensorType)
            .floatField('value', value)
            .timestamp(randomTime);

        writeClient.writePoint(point);
    }
    
    writeClient.flush();
}

// ============================================================================
// Input Validation and Sanitization Functions
// ============================================================================

/**
 * Validates and sanitizes sensor box identifier
 * Removes Flux special characters and operators to prevent injection attacks
 * 
 * @param {string} value - Raw input value
 * @returns {string|null} - Sanitized value or null if invalid
 */
export function sanitizeSensorBox(value) {
    if (!value || typeof value !== 'string') return null;
    
    // Allow only: alphanumeric, underscore, hyphen, dot
    const sanitized = value
        .trim()
        .replace(/[^a-zA-Z0-9_.-]/g, '')
        .substring(0, MAX_STRING_LENGTH);
    
    if (sanitized.length === 0 || sanitized.length > MAX_STRING_LENGTH) {
        return null;
    }
    
    return sanitized;
}

/**
 * Validates and sanitizes sensor type identifier
 * Removes Flux special characters and operators to prevent injection attacks
 * 
 * @param {string} value - Raw input value
 * @returns {string|null} - Sanitized value or null if invalid
 */
export function sanitizeSensorType(value) {
    if (!value || typeof value !== 'string') return null;
    
    // Allow only: alphanumeric, underscore, hyphen, dot
    const sanitized = value
        .trim()
        .replace(/[^a-zA-Z0-9_.-]/g, '')
        .substring(0, MAX_STRING_LENGTH);
    
    if (sanitized.length === 0 || sanitized.length > MAX_STRING_LENGTH) {
        return null;
    }
    
    return sanitized;
}

/**
 * Validates and sanitizes Flux time expression
 * Supports relative time, RFC3339 timestamps, and now() function
 * 
 * @param {string} value - Raw input value
 * @param {string} defaultValue - Default value if invalid (default: '-24h')
 * @returns {string} - Validated time expression
 */
export function sanitizeFluxTime(value, defaultValue = '-24h') {
    if (!value || typeof value !== 'string') return defaultValue;
    
    const trimmed = value.trim();
    
    // Valid patterns
    const relativeTimePattern = /^-?\d+[hmsd]$/;
    const rfc3339Pattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$/;
    const nowPattern = /^now\(\)$/;
    
    if (relativeTimePattern.test(trimmed) || 
        rfc3339Pattern.test(trimmed) || 
        nowPattern.test(trimmed)) {
        
        // Additional validation: limit relative time to reasonable ranges
        if (relativeTimePattern.test(trimmed)) {
            const match = trimmed.match(/^(-?\d+)([hmsd])$/);
            if (match) {
                const num = parseInt(match[1]);
                const unit = match[2];
                // Limit to max 1 year
                const maxValues = { h: 8760, m: 525600, s: 31536000, d: 365 };
                if (Math.abs(num) > maxValues[unit]) {
                    return defaultValue;
                }
            }
        }
        return trimmed.substring(0, 50); // Limit length
    }
    
    return defaultValue;
}

/**
 * Validates and sanitizes limit value
 * Prevents resource exhaustion by capping results
 * 
 * @param {string|number} value - Raw input value
 * @returns {number} - Validated limit (1 to MAX_LIMIT)
 */
export function sanitizeLimit(value) {
    if (value === undefined || value === null) return MAX_LIMIT;
    
    const num = typeof value === 'string' ? parseInt(value, 10) : Number(value);
    
    if (!Number.isFinite(num) || num < 1) {
        return MAX_LIMIT;
    }
    
    return Math.min(Math.floor(num), MAX_LIMIT);
}

// ============================================================================
// Query Building Functions
// ============================================================================

/**
 * Escapes a string value for safe use in Flux filter expressions
 * Prevents injection through string values
 * 
 * @param {string} value - Value to escape
 * @returns {string} - Escaped value safe for Flux queries
 * @throws {Error} If value is not a string
 */
function escapeFluxString(value) {
    if (typeof value !== 'string') {
        throw new Error('Value must be a string');
    }
    
    // Escape special characters for Flux string literals
    return value
        .replace(/\\/g, '\\\\')  // Escape backslashes first
        .replace(/"/g, '\\"')   // Escape double quotes
        .replace(/\n/g, '\\n')   // Escape newlines
        .replace(/\r/g, '\\r')   // Escape carriage returns
        .replace(/\t/g, '\\t');  // Escape tabs
}

/**
 * Builds a secure Flux query with validated and sanitized inputs
 * All user inputs are validated and escaped to prevent injection attacks
 * 
 * @param {string} bucket - InfluxDB bucket name (from config, not user input)
 * @param {Object} options - Query options
 * @param {string} [options.sensor_box] - Optional sensor box filter
 * @param {string} [options.sensor_type] - Optional sensor type filter
 * @param {string} [options.start_time] - Start time (default: '-24h')
 * @param {string} [options.end_time] - End time (default: 'now()')
 * @param {number|string} [options.limit] - Result limit (default: MAX_LIMIT)
 * @returns {string} - Secure Flux query string
 * @throws {Error} If bucket name is invalid
 */
export function buildSecureFluxQuery(bucket, options = {}) {
    // Validate bucket name (should come from config, but validate anyway)
    if (!bucket || typeof bucket !== 'string') {
        throw new Error('Invalid bucket name');
    }
    
    // Sanitize all inputs
    const startTime = sanitizeFluxTime(options.start_time, '-24h');
    const endTime = sanitizeFluxTime(options.end_time, 'now()');
    const limit = sanitizeLimit(options.limit);
    
    // Build base query with safe bucket name (from config)
    const escapedBucket = escapeFluxString(bucket);
    let query = `from(bucket: "${escapedBucket}")
 |> range(start: ${startTime}, stop: ${endTime})
 |> filter(fn: (r) => r._measurement == "sensor_data")`;
    
    // Add sensor_box filter if provided (sanitized)
    if (options.sensor_box) {
        const sanitizedBox = sanitizeSensorBox(options.sensor_box);
        if (sanitizedBox) {
            const escapedBox = escapeFluxString(sanitizedBox);
            query += `\n |> filter(fn: (r) => r.sensor_box == "${escapedBox}")`;
        }
    }
    
    // Add sensor_type filter if provided (sanitized)
    if (options.sensor_type) {
        const sanitizedType = sanitizeSensorType(options.sensor_type);
        if (sanitizedType) {
            const escapedType = escapeFluxString(sanitizedType);
            query += `\n |> filter(fn: (r) => r.sensor_type == "${escapedType}")`;
        }
    }
    
    // Add limit (always applied for performance and DoS protection)
    query += `\n |> limit(n: ${limit})`;
    
    return query;
}

// ============================================================================
// Data Formatting Functions
// ============================================================================

/**
 * Formats sensor data from InfluxDB query result for API response
 * 
 * @param {Object} tableObject - Raw table object from InfluxDB
 * @returns {Object} - Formatted sensor data object
 */
export function formatSensorData(tableObject) {
    return {
        timestamp: tableObject._time,
        sensor_box: tableObject.sensor_box,
        sensor_type: tableObject.sensor_type,
        value: tableObject._value
    };
}
