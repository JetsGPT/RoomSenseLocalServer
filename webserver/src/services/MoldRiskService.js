import { influxClient, organisation, bucket } from '../routes/sensors/influxClient.js';
import { buildSecureFluxQuery } from '../routes/sensors/utils.js';

class MoldRiskService {
    constructor() {
        // Constants for logic
        this.DANGER_TEMP_MIN = 20;
        this.DANGER_TEMP_MAX = 25;
        this.DANGER_HUMIDITY_MIN = 70;

        this.WARNING_HUMIDITY_MIN = 60;
        this.WARNING_HUMIDITY_MAX = 70;

        // Thresholds in hours
        this.DANGER_DURATION_HOURS = 24;
        this.WARNING_DURATION_HOURS = 12;

        // Gap tolerance (if data is missing for > 1h, break the chain)
        this.GAP_TOLERANCE_MS = 60 * 60 * 1000;
    }

    /**
     * Calculate mold risk for a specific sensor box
     * @param {string} sensorBox - The sensor box ID
     * @returns {Promise<Object>} - Risk assessment result
     */
    async calculateMoldRisk(sensorBox) {
        // We need 48h history to cover the 24h "Danger" requirement + buffer
        // Using 48h is safe.
        const startTime = '-48h';

        // Flux query to get pivoted data (Temp & Humidity in same row)
        // using aggregateWindow to regularize data to 15m intervals
        const query = `
            from(bucket: "${bucket}")
                |> range(start: ${startTime})
                |> filter(fn: (r) => r["_measurement"] == "sensor_data")
                |> filter(fn: (r) => r["sensor_box"] == "${sensorBox}")
                |> filter(fn: (r) => r["sensor_type"] == "temperature" or r["sensor_type"] == "humidity")
                |> aggregateWindow(every: 15m, fn: mean, createEmpty: false)
                |> pivot(rowKey:["_time"], columnKey: ["sensor_type"], valueColumn: "_value")
                |> sort(columns: ["_time"], desc: true)
        `;

        const data = [];
        const queryClient = influxClient.getQueryApi(organisation);

        return new Promise((resolve, reject) => {
            queryClient.queryRows(query, {
                next: (row, tableMeta) => {
                    const o = tableMeta.toObject(row);
                    data.push({
                        timestamp: new Date(o._time).getTime(),
                        temperature: o.temperature,
                        humidity: o.humidity
                    });
                },
                error: (error) => {
                    console.error('Error calculating mold risk:', error);
                    reject(error);
                },
                complete: () => {
                    resolve(this.processRiskLogic(data));
                }
            });
        });
    }

    processRiskLogic(history) {
        if (!history || history.length === 0) {
            return { status: 'unknown', riskScore: 0, details: "No data available" };
        }

        const current = history[0];
        // Time since last reading
        const now = Date.now();
        const timeDiff = now - current.timestamp;

        // If data is too old (> 1h), mark as stale? User said: "Maintain last known state but add stale visual"
        // We'll return the calculated state but flag it as stale.
        const isStale = timeDiff > this.GAP_TOLERANCE_MS;

        // --- Calculate Durations (Backwards from latest) ---
        let dangerDurationMs = 0;
        let warningDurationMs = 0;
        let lastTime = current.timestamp;

        // Helper to check conditions
        const isDanger = (t, h) => (t >= this.DANGER_TEMP_MIN && t <= this.DANGER_TEMP_MAX && h > this.DANGER_HUMIDITY_MIN);
        const isWarning = (h) => (h >= this.WARNING_HUMIDITY_MIN && h <= this.WARNING_HUMIDITY_MAX);

        // We iterate backwards to find sustained duration *ending now*

        // 1. Check Danger Duration
        for (let i = 0; i < history.length; i++) {
            const point = history[i];

            // Check for gaps
            if (Math.abs(lastTime - point.timestamp) > this.GAP_TOLERANCE_MS && i > 0) {
                break; // Stop if gap found
            }
            lastTime = point.timestamp;

            if (isDanger(point.temperature, point.humidity)) {
                // Add time difference to next point (or 15m for the first/last)
                // Since we aggregate at 15m, we can just add 15m per point, or use actual Time diff
                // Using 15m is simpler and matches the aggregation
                dangerDurationMs += 15 * 60 * 1000;
            } else {
                break; // Condition broken
            }
        }

        // 2. Check Warning Duration (only if not already Red? No, check independently based on logic)
        // User logic: Warning if H in [60, 70] for > 12h.
        // If it is CURRENTLY Red, it overrides Yellow.

        lastTime = current.timestamp;
        for (let i = 0; i < history.length; i++) {
            const point = history[i];
            if (Math.abs(lastTime - point.timestamp) > this.GAP_TOLERANCE_MS && i > 0) {
                break;
            }
            lastTime = point.timestamp;

            if (isWarning(point.humidity)) {
                warningDurationMs += 15 * 60 * 1000;
            } else {
                break;
            }
        }

        const dangerHours = dangerDurationMs / (1000 * 60 * 60);
        const warningHours = warningDurationMs / (1000 * 60 * 60);

        // Determine Status
        let status = 'green';
        let explanation = 'Conditions are safe.';

        if (dangerHours > this.DANGER_DURATION_HOURS) {
            status = 'red';
            explanation = `High humidity (>70%) and temp (20-25°C) sustained for ${dangerHours.toFixed(1)}h.`;
        } else if (warningHours > this.WARNING_DURATION_HOURS) {
            status = 'yellow';
            explanation = `Elevated humidity (60-70%) sustained for ${warningHours.toFixed(1)}h.`;
        } else {
            // Check for Green override logic? "H < 55% OR T outside growth range"
            // If not Red or Yellow, it's effectively Green.
            // But we can be specific about "Why" it is green.
            if (current.humidity < 55) explanation = "Humidity is low (<55%).";
            else if (current.temperature < 15 || current.temperature > 30) explanation = "Temperature is outside mold growth range.";
            else explanation = "Conditions are within safe limits.";
        }

        // Add "Risk Score" (0-100) for visualization?
        // Maybe map duration to score?
        // Green: 0-33, Yellow: 34-66, Red: 67-100?
        // Or just return the raw durations and let UI handle it.
        // Let's return a score based on progress to next threshold.

        let riskScore = 0;
        if (status === 'red') {
            riskScore = 100;
        } else if (status === 'yellow') {
            // scale 50-90 based on progress to Red? 
            // Warning logic is independent of Red logic (Warning excludes >70% H).
            // So if we are in Warning state, max risk is bounded.
            // Let's just say Yellow = 50 + (hours/12 * 40)?
            riskScore = 50 + Math.min(40, (warningHours / this.WARNING_DURATION_HOURS) * 40);
        } else {
            // Green. 
            // If H is high but not yet 12h?
            // Calculate potential risk.
            if (isDanger(current.temperature, current.humidity)) {
                // Progress to Red
                riskScore = (dangerHours / this.DANGER_DURATION_HOURS) * 90;
            } else if (isWarning(current.humidity)) {
                // Progress to Yellow
                riskScore = (warningHours / this.WARNING_DURATION_HOURS) * 50;
            } else {
                riskScore = current.humidity / 2; // Baseline based on humidity?
            }
        }

        return {
            status,
            riskScore: Math.min(100, Math.round(riskScore)),
            explanation,
            currentTemp: current.temperature,
            currentHumidity: current.humidity,
            dangerDurationHours: dangerHours,
            warningDurationHours: warningHours,
            isStale,
            timestamp: current.timestamp
        };
    }
}

export default new MoldRiskService();
