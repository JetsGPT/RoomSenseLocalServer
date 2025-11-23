import express from 'express';
import { requireLogin } from '../../auth/auth.js';
import { 
    writeSensorData, 
    writeTestData, 
    sanitizeSensorBox, 
    sanitizeSensorType 
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
 * Validates sensor data input
 */
function validateSensorData(sensor_box, sensor_type, value) {
    const errors = [];
    
    if (!sensor_box || !sensor_type || value === undefined) {
        errors.push('sensor_box, sensor_type, and value are required');
        return { valid: false, errors };
    }
    
    const sanitizedBox = sanitizeSensorBox(sensor_box);
    if (!sanitizedBox) {
        errors.push({
            field: 'sensor_box',
            message: 'Invalid sensor_box format',
            detail: 'sensor_box must contain only alphanumeric characters, underscores, hyphens, and dots'
        });
    }
    
    const sanitizedType = sanitizeSensorType(sensor_type);
    if (!sanitizedType) {
        errors.push({
            field: 'sensor_type',
            message: 'Invalid sensor_type format',
            detail: 'sensor_type must contain only alphanumeric characters, underscores, hyphens, and dots'
        });
    }
    
    const numValue = typeof value === 'string' ? parseFloat(value) : Number(value);
    if (!Number.isFinite(numValue)) {
        errors.push({
            field: 'value',
            message: 'Invalid value format',
            detail: 'value must be a valid number'
        });
    }
    
    return {
        valid: errors.length === 0,
        errors,
        sanitized: {
            sensor_box: sanitizedBox,
            sensor_type: sanitizedType,
            value: numValue
        }
    };
}

// ============================================================================
// Data Writing Endpoints
// ============================================================================

/**
 * POST /api/sensors/data
 * Write sensor data to InfluxDB
 */
router.post('/data', requireLogin, (req, res) => {
    const { sensor_box, sensor_type, value } = req.body;
    
    // Validate and sanitize inputs
    const validation = validateSensorData(sensor_box, sensor_type, value);
    
    if (!validation.valid) {
        // Log security warnings for invalid inputs
        validation.errors.forEach(error => {
            if (typeof error === 'object' && error.field) {
                const fieldValue = error.field === 'sensor_box' ? sensor_box : 
                                 error.field === 'sensor_type' ? sensor_type : value;
                logSecurityWarning(req, error.field, fieldValue, error.message);
            }
        });
        
        // Return first error (or generic message)
        const firstError = validation.errors[0];
        if (typeof firstError === 'object' && firstError.message) {
            return res.status(400).json({ 
                error: firstError.message,
                detail: firstError.detail
            });
        }
        return res.status(400).json({ error: firstError });
    }
    
    // Write validated and sanitized data
    try {
        writeSensorData(
            validation.sanitized.sensor_box,
            validation.sanitized.sensor_type,
            validation.sanitized.value
        );
        res.status(200).json({ message: 'Sensor data written successfully' });
    } catch (error) {
        console.error('Error writing sensor data:', error);
        res.status(500).json({ error: 'Failed to write sensor data' });
    }
});

/**
 * GET /api/sensors/writeTestData
 * Write test data to InfluxDB for development/testing
 */
router.get('/writeTestData', requireLogin, (req, res) => {
    try {
        writeTestData();
        res.status(200).json({ message: 'Test data has been written.' });
    } catch (error) {
        console.error('Error writing test data:', error);
        res.status(500).json({ error: 'Failed to write test data' });
    }
});

export default router;
