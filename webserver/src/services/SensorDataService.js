/**
 * SensorDataService
 *
 * Data access layer for AI tool calling. Provides helper functions that fetch
 * real-time sensor data from InfluxDB and device/rule metadata from PostgreSQL.
 *
 * All functions return { success: boolean, data: any, error?: string } so the
 * AI always gets structured results it can reason about.
 *
 * Room names are resolved dynamically: display_name → technical name (box_id)
 * via the ble_connections table, same pattern used in dataRetrieval.js.
 */

import { influxClient, organisation, bucket } from '../routes/sensors/influxClient.js';
import { sanitizeSensorBox, sanitizeSensorType, sanitizeFluxTime } from '../routes/sensors/utils.js';
import moldRiskService from './MoldRiskService.js';
import { DEFAULT_LOCATION } from '../config/weatherConfig.js';

class SensorDataService {
    constructor() {
        this.pool = null;
    }

    /**
     * Initialize with the shared PostgreSQL pool
     * @param {import('pg').Pool} pool
     */
    initialize(pool) {
        this.pool = pool;
        console.log('✓ SensorDataService initialized');
    }

    // ========================================================================
    // Room Name Resolution
    // ========================================================================

    /**
     * Resolve a display name (e.g. "Living Room") to a technical box name (e.g. "box_4C2E26").
     * If the input is already a technical name, returns it as-is.
     * @param {string} displayName
     * @returns {Promise<string>} - The technical box name
     */
    async resolveRoomName(displayName) {
        if (!this.pool || !displayName) return displayName;

        try {
            // First check if it's a display_name
            const result = await this.pool.query(
                'SELECT name FROM ble_connections WHERE LOWER(display_name) = LOWER($1)',
                [displayName]
            );
            if (result.rows.length > 0 && result.rows[0].name) {
                return result.rows[0].name;
            }

            // Maybe it's already a technical name — check if it exists
            const techResult = await this.pool.query(
                'SELECT name FROM ble_connections WHERE LOWER(name) = LOWER($1)',
                [displayName]
            );
            if (techResult.rows.length > 0) {
                return techResult.rows[0].name;
            }

            // Fall through: return sanitized input as-is (maybe it's a box id not in DB)
            return sanitizeSensorBox(displayName) || displayName;
        } catch (error) {
            console.error('[SensorDataService] Error resolving room name:', error.message);
            return displayName;
        }
    }

    /**
     * Get display name for a technical box name
     * @param {string} technicalName
     * @returns {Promise<string>}
     */
    async getDisplayName(technicalName) {
        if (!this.pool) return technicalName;
        try {
            const result = await this.pool.query(
                'SELECT display_name FROM ble_connections WHERE name = $1',
                [technicalName]
            );
            return result.rows[0]?.display_name || technicalName;
        } catch {
            return technicalName;
        }
    }

    // ========================================================================
    // Sensor Data Queries
    // ========================================================================

    /**
     * Get the latest sensor reading for a specific room and sensor type
     */
    async getLatestReading(roomName, sensorType) {
        try {
            const technicalName = await this.resolveRoomName(roomName);
            const sanitizedType = sanitizeSensorType(sensorType);

            if (!sanitizedType) {
                return { success: false, error: `Invalid sensor type: ${sensorType}` };
            }

            const queryClient = influxClient.getQueryApi(organisation);
            const escapedBox = this._escapeFlux(technicalName);
            const escapedType = this._escapeFlux(sanitizedType);

            const fluxQuery = `
                from(bucket: "${bucket}")
                    |> range(start: -1h)
                    |> filter(fn: (r) => r["_measurement"] == "sensor_data")
                    |> filter(fn: (r) => r["sensor_box"] == "${escapedBox}")
                    |> filter(fn: (r) => r["sensor_type"] == "${escapedType}")
                    |> filter(fn: (r) => r["_field"] == "value")
                    |> last()
            `;

            const reading = await this._executeInfluxQuery(queryClient, fluxQuery);
            const displayName = await this.getDisplayName(technicalName);

            if (reading.length === 0) {
                return {
                    success: false,
                    error: `No recent data found for ${displayName} / ${sensorType} (within last hour)`
                };
            }

            const row = reading[0];
            return {
                success: true,
                data: {
                    room: displayName,
                    box_id: technicalName,
                    sensor_type: row.sensor_type,
                    value: parseFloat(row._value),
                    unit: this._getUnit(row.sensor_type),
                    timestamp: row._time
                }
            };
        } catch (error) {
            return { success: false, error: `Failed to get reading: ${error.message}` };
        }
    }

    /**
     * Get latest readings for ALL rooms and ALL sensor types at once
     */
    async getAllLatestReadings() {
        try {
            const queryClient = influxClient.getQueryApi(organisation);

            const fluxQuery = `
                from(bucket: "${bucket}")
                    |> range(start: -1h)
                    |> filter(fn: (r) => r["_measurement"] == "sensor_data")
                    |> filter(fn: (r) => r["_field"] == "value")
                    |> group(columns: ["sensor_box", "sensor_type"])
                    |> last()
            `;

            const rows = await this._executeInfluxQuery(queryClient, fluxQuery);

            if (rows.length === 0) {
                return { success: false, error: 'No recent sensor data available' };
            }

            // Group by room
            const roomMap = {};
            for (const row of rows) {
                const displayName = await this.getDisplayName(row.sensor_box);
                if (!roomMap[displayName]) {
                    roomMap[displayName] = { room: displayName, box_id: row.sensor_box, sensors: {} };
                }
                roomMap[displayName].sensors[row.sensor_type] = {
                    value: parseFloat(row._value),
                    unit: this._getUnit(row.sensor_type),
                    timestamp: row._time
                };
            }

            return {
                success: true,
                data: Object.values(roomMap)
            };
        } catch (error) {
            return { success: false, error: `Failed to get readings: ${error.message}` };
        }
    }

    /**
     * Get sensor history with time range and optional aggregation
     */
    async getSensorHistory(roomName, sensorType, startTime, endTime, aggregation) {
        try {
            const technicalName = await this.resolveRoomName(roomName);
            const sanitizedType = sanitizeSensorType(sensorType);
            const sanitizedStart = sanitizeFluxTime(startTime, '-24h');
            const sanitizedEnd = sanitizeFluxTime(endTime, 'now()');
            const validAggregations = ['mean', 'min', 'max', 'sum', 'count'];
            const safeAggregation = validAggregations.includes(aggregation) ? aggregation : 'mean';

            if (!sanitizedType) {
                return { success: false, error: `Invalid sensor type: ${sensorType}` };
            }

            const queryClient = influxClient.getQueryApi(organisation);
            const escapedBox = this._escapeFlux(technicalName);
            const escapedType = this._escapeFlux(sanitizedType);

            // Determine aggregation window based on time range
            const windowSize = this._calculateWindow(sanitizedStart);

            const fluxQuery = `
                from(bucket: "${bucket}")
                    |> range(start: ${sanitizedStart}, stop: ${sanitizedEnd})
                    |> filter(fn: (r) => r["_measurement"] == "sensor_data")
                    |> filter(fn: (r) => r["sensor_box"] == "${escapedBox}")
                    |> filter(fn: (r) => r["sensor_type"] == "${escapedType}")
                    |> filter(fn: (r) => r["_field"] == "value")
                    |> aggregateWindow(every: ${windowSize}, fn: ${safeAggregation}, createEmpty: false)
                    |> yield(name: "${safeAggregation}")
            `;

            const rows = await this._executeInfluxQuery(queryClient, fluxQuery);
            const displayName = await this.getDisplayName(technicalName);

            if (rows.length === 0) {
                return {
                    success: false,
                    error: `No data found for ${displayName} / ${sensorType} in the specified time range`
                };
            }

            // Calculate summary statistics
            const values = rows.map(r => parseFloat(r._value)).filter(v => !isNaN(v));
            const summary = {
                min: Math.min(...values),
                max: Math.max(...values),
                mean: values.reduce((a, b) => a + b, 0) / values.length,
                count: values.length
            };

            return {
                success: true,
                data: {
                    room: displayName,
                    box_id: technicalName,
                    sensor_type: sanitizedType,
                    unit: this._getUnit(sanitizedType),
                    aggregation: safeAggregation,
                    time_range: { start: sanitizedStart, end: sanitizedEnd },
                    summary,
                    data_points: rows.map(r => ({
                        timestamp: r._time,
                        value: parseFloat(r._value)
                    }))
                }
            };
        } catch (error) {
            return { success: false, error: `Failed to get history: ${error.message}` };
        }
    }

    // ========================================================================
    // Device & Discovery Queries
    // ========================================================================

    /**
     * Get all active devices with display names
     */
    async getActiveDevices() {
        try {
            if (!this.pool) {
                return { success: false, error: 'Database not available' };
            }

            const result = await this.pool.query(
                'SELECT address, name, display_name, last_seen, is_active FROM ble_connections WHERE is_active = TRUE'
            );

            const devices = result.rows.map(row => ({
                address: row.address,
                box_id: row.name,
                display_name: row.display_name || row.name,
                last_seen: row.last_seen,
                is_active: row.is_active
            }));

            return { success: true, data: devices };
        } catch (error) {
            return { success: false, error: `Failed to get devices: ${error.message}` };
        }
    }

    /**
     * Get all available sensor types from InfluxDB (dynamic discovery)
     */
    async getAvailableSensorTypes() {
        try {
            const queryClient = influxClient.getQueryApi(organisation);

            const fluxQuery = `
                from(bucket: "${bucket}")
                    |> range(start: -30d)
                    |> filter(fn: (r) => r["_measurement"] == "sensor_data")
                    |> keep(columns: ["sensor_type"])
                    |> distinct(column: "sensor_type")
            `;

            const rows = await this._executeInfluxQuery(queryClient, fluxQuery);
            const types = rows
                .map(r => r.sensor_type || r._value)
                .filter(Boolean);

            return { success: true, data: [...new Set(types)] };
        } catch (error) {
            return { success: false, error: `Failed to get sensor types: ${error.message}` };
        }
    }

    // ========================================================================
    // Mold Risk
    // ========================================================================

    /**
     * Get mold risk for a specific room
     */
    async getMoldRisk(roomName) {
        try {
            const technicalName = await this.resolveRoomName(roomName);
            const riskData = await moldRiskService.calculateMoldRisk(technicalName);
            const displayName = await this.getDisplayName(technicalName);

            return {
                success: true,
                data: {
                    room: displayName,
                    box_id: technicalName,
                    ...riskData
                }
            };
        } catch (error) {
            return { success: false, error: `Failed to calculate mold risk: ${error.message}` };
        }
    }

    /**
     * Get mold risk for ALL active rooms
     */
    async getMoldRiskAllRooms() {
        try {
            const devicesResult = await this.getActiveDevices();
            if (!devicesResult.success) return devicesResult;

            const results = [];
            for (const device of devicesResult.data) {
                try {
                    const riskData = await moldRiskService.calculateMoldRisk(device.box_id);
                    results.push({
                        room: device.display_name,
                        box_id: device.box_id,
                        ...riskData
                    });
                } catch (error) {
                    results.push({
                        room: device.display_name,
                        box_id: device.box_id,
                        status: 'error',
                        error: error.message
                    });
                }
            }

            return { success: true, data: results };
        } catch (error) {
            return { success: false, error: `Failed to get mold risk: ${error.message}` };
        }
    }

    // ========================================================================
    // Notification Rules
    // ========================================================================

    /**
     * Get notification rules for a specific user
     */
    async getNotificationRules(userId) {
        try {
            if (!this.pool) {
                return { success: false, error: 'Database not available' };
            }

            const result = await this.pool.query(`
                SELECT 
                    nr.id, nr.name, nr.sensor_id, nr.sensor_type, nr.condition, nr.threshold,
                    nr.notification_provider, nr.notification_target, nr.notification_priority,
                    nr.is_enabled, nr.last_triggered_at, nr.trigger_count,
                    bc.display_name as room_name
                FROM notification_rules nr
                LEFT JOIN ble_connections bc ON nr.sensor_id = bc.address
                WHERE nr.user_id = $1
                ORDER BY nr.created_at DESC
            `, [userId]);

            const rules = result.rows.map(row => ({
                name: row.name,
                room: row.room_name || row.sensor_id,
                sensor_type: row.sensor_type,
                condition: `${row.condition} ${row.threshold}`,
                provider: row.notification_provider,
                target: row.notification_target,
                enabled: row.is_enabled,
                last_triggered: row.last_triggered_at,
                trigger_count: row.trigger_count
            }));

            return { success: true, data: rules };
        } catch (error) {
            return { success: false, error: `Failed to get rules: ${error.message}` };
        }
    }

    // ========================================================================
    // Weather
    // ========================================================================

    /**
     * Get the saved weather location from DB, or fall back to DEFAULT_LOCATION
     */
    async _getSavedLocation() {
        if (!this.pool) return DEFAULT_LOCATION;
        try {
            const result = await this.pool.query(
                "SELECT value FROM system_settings WHERE key = 'weather_location'"
            );
            if (result.rows.length > 0 && result.rows[0].value) {
                return JSON.parse(result.rows[0].value);
            }
        } catch (err) {
            console.warn('[SensorDataService] Could not read saved location:', err.message);
        }
        return DEFAULT_LOCATION;
    }

    /**
     * Get current outdoor weather from OpenMeteo
     */
    async getCurrentWeather() {
        try {
            const { latitude, longitude, name } = await this._getSavedLocation();
            const apiUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation&timezone=auto`;

            const response = await fetch(apiUrl);
            if (!response.ok) throw new Error(`OpenMeteo API error: ${response.statusText}`);

            const data = await response.json();
            const current = data.current;

            return {
                success: true,
                data: {
                    location: name,
                    temperature: current.temperature_2m,
                    temperature_unit: data.current_units?.temperature_2m || '°C',
                    humidity: current.relative_humidity_2m,
                    humidity_unit: '%',
                    wind_speed: current.wind_speed_10m,
                    wind_speed_unit: data.current_units?.wind_speed_10m || 'km/h',
                    precipitation: current.precipitation,
                    precipitation_unit: data.current_units?.precipitation || 'mm',
                    timestamp: current.time
                }
            };
        } catch (error) {
            return { success: false, error: `Failed to get weather: ${error.message}` };
        }
    }


    // ========================================================================
    // Internal Helpers
    // ========================================================================

    /**
     * Execute an InfluxDB Flux query and return all rows as objects
     */
    _executeInfluxQuery(queryClient, fluxQuery) {
        return new Promise((resolve, reject) => {
            const rows = [];
            queryClient.queryRows(fluxQuery, {
                next: (row, tableMeta) => {
                    rows.push(tableMeta.toObject(row));
                },
                error: (error) => {
                    reject(error);
                },
                complete: () => {
                    resolve(rows);
                }
            });
        });
    }

    /**
     * Escape a string for safe use in Flux queries
     */
    _escapeFlux(value) {
        if (typeof value !== 'string') return '';
        return value
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r');
    }

    /**
     * Get a human-friendly unit for a sensor type
     * Returns empty string for unknown types (dynamic sensors)
     */
    _getUnit(sensorType) {
        const units = {
            temperature: '°C',
            humidity: '%',
            pressure: 'hPa',
            light: 'lux',
            co2: 'ppm',
            voc: 'ppb',
            battery: '%'
        };
        return units[sensorType?.toLowerCase()] || '';
    }

    /**
     * Calculate an appropriate aggregation window based on the time range
     */
    _calculateWindow(startTime) {
        // Parse relative time like "-24h", "-7d", "-365d"
        const match = startTime.match(/^-?(\d+)([hmsd])$/);
        if (!match) return '15m'; // Default

        const num = parseInt(match[1]);
        const unit = match[2];

        // Convert to hours
        let hours;
        switch (unit) {
            case 'm': hours = num / 60; break;
            case 'h': hours = num; break;
            case 'd': hours = num * 24; break;
            case 's': hours = num / 3600; break;
            default: hours = 24;
        }

        if (hours <= 6) return '5m';
        if (hours <= 24) return '15m';
        if (hours <= 168) return '1h';   // 7 days
        if (hours <= 720) return '6h';   // 30 days
        return '1d';                      // > 30 days
    }
}

// Singleton
const sensorDataService = new SensorDataService();
export default sensorDataService;
