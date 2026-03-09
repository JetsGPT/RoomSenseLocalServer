import express from 'express';
import { requireLogin } from '../auth/auth.js';
import { DEFAULT_LOCATION } from '../config/weatherConfig.js';

const router = express.Router();
const authMiddleware = requireLogin;

// Simple in-memory cache
let weatherCache = {
    current: null,
    historical: new Map(),
};

const CACHE_DURATION = 15 * 60 * 1000; // 15 minutes
const HISTORICAL_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

const getCachedData = (cache, key, duration) => {
    if (cache.has(key)) {
        const entry = cache.get(key);
        if (Date.now() - entry.timestamp < duration) {
            return entry.data;
        }
    }
    return null;
};

// ========================================================================
// Helper: get saved location from DB, fall back to DEFAULT_LOCATION
// ========================================================================
async function getSavedLocation(pool) {
    try {
        const result = await pool.query(
            "SELECT value FROM system_settings WHERE key = 'weather_location'"
        );
        if (result.rows.length > 0 && result.rows[0].value) {
            return JSON.parse(result.rows[0].value);
        }
    } catch (err) {
        console.warn('[Weather] Could not read saved location:', err.message);
    }
    return DEFAULT_LOCATION;
}

// ========================================================================
// Location CRUD
// ========================================================================

/** GET /api/weather/location — get the saved weather location */
router.get('/location', authMiddleware, async (req, res) => {
    try {
        const pool = req.app.locals.pool;
        const loc = await getSavedLocation(pool);
        res.json(loc);
    } catch (error) {
        console.error('[Weather] Error getting location:', error);
        res.status(500).json({ error: 'Failed to get location' });
    }
});

/** PUT /api/weather/location — save a weather location */
router.put('/location', authMiddleware, async (req, res) => {
    try {
        const { latitude, longitude, name } = req.body;
        if (latitude == null || longitude == null) {
            return res.status(400).json({ error: 'latitude and longitude are required' });
        }

        const pool = req.app.locals.pool;
        const userId = req.session.user.id;
        const value = JSON.stringify({
            latitude: parseFloat(latitude),
            longitude: parseFloat(longitude),
            name: name || 'Custom Location'
        });

        await pool.query(`
            INSERT INTO system_settings (key, value, is_sensitive, description, updated_by)
            VALUES ('weather_location', $1, FALSE, 'Weather location (lat/lon/name)', $2)
            ON CONFLICT (key) DO UPDATE SET value = $1, updated_by = $2
        `, [value, userId]);

        // Clear weather cache so next fetch uses the new location
        weatherCache.current = null;
        weatherCache.historical.clear();

        console.log(`✓ Weather location updated to ${name} (${latitude}, ${longitude}) by user ${userId}`);
        res.json({ latitude: parseFloat(latitude), longitude: parseFloat(longitude), name });
    } catch (error) {
        console.error('[Weather] Error saving location:', error);
        res.status(500).json({ error: 'Failed to save location' });
    }
});

// ========================================================================
// Geocode proxy (Open-Meteo Geocoding API — free, no key required)
// ========================================================================

/** GET /api/weather/geocode?q=Vienna */
router.get('/geocode', authMiddleware, async (req, res) => {
    try {
        const { q } = req.query;
        if (!q || q.trim().length < 2) {
            return res.status(400).json({ error: 'Query must be at least 2 characters' });
        }

        const apiUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q.trim())}&count=8&language=en&format=json`;
        const response = await fetch(apiUrl);
        if (!response.ok) throw new Error(`Geocoding API error: ${response.statusText}`);
        const data = await response.json();

        // Return simplified results
        const results = (data.results || []).map(r => ({
            name: r.name,
            country: r.country || '',
            countryCode: r.country_code || '',
            admin1: r.admin1 || '', // state/province
            latitude: r.latitude,
            longitude: r.longitude
        }));

        res.json(results);
    } catch (error) {
        console.error('[Weather] Geocode error:', error);
        res.status(500).json({ error: 'Failed to search locations' });
    }
});

// ========================================================================
// Current & Historical weather (now reads saved location as default)
// ========================================================================

router.get('/current', authMiddleware, async (req, res) => {
    try {
        const pool = req.app.locals.pool;
        const savedLoc = await getSavedLocation(pool);
        const latitude = req.query.latitude || savedLoc.latitude;
        const longitude = req.query.longitude || savedLoc.longitude;

        const locationKey = `${latitude},${longitude}`;
        const now = Date.now();

        if (weatherCache.current &&
            weatherCache.current.location === locationKey &&
            (now - weatherCache.current.timestamp < CACHE_DURATION)) {
            console.log('Serving current weather from cache');
            return res.json(weatherCache.current.data);
        }

        console.log('Fetching fresh weather data from OpenMeteo');
        const apiUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation&hourly=temperature_2m,relative_humidity_2m&timezone=auto&forecast_days=1`;

        const response = await fetch(apiUrl);
        if (!response.ok) throw new Error(`OpenMeteo API error: ${response.statusText}`);
        const data = await response.json();

        weatherCache.current = { data, timestamp: now, location: locationKey };
        res.json(data);
    } catch (error) {
        console.error('Error fetching current weather:', error);
        res.status(500).json({ error: 'Failed to fetch weather data' });
    }
});

router.get('/historical', authMiddleware, async (req, res) => {
    try {
        const pool = req.app.locals.pool;
        const savedLoc = await getSavedLocation(pool);
        const latitude = req.query.latitude || savedLoc.latitude;
        const longitude = req.query.longitude || savedLoc.longitude;
        const { start_date, end_date } = req.query;

        if (!start_date || !end_date) {
            return res.status(400).json({ error: 'start_date and end_date are required (YYYY-MM-DD)' });
        }

        const cacheKey = `${latitude},${longitude},${start_date},${end_date}`;
        const cached = getCachedData(weatherCache.historical, cacheKey, HISTORICAL_CACHE_DURATION);
        if (cached) {
            console.log('Serving historical weather from cache');
            return res.json(cached);
        }

        console.log(`Fetching historical weather: ${start_date} to ${end_date}`);
        const apiUrl = `https://archive-api.open-meteo.com/v1/archive?latitude=${latitude}&longitude=${longitude}&start_date=${start_date}&end_date=${end_date}&hourly=temperature_2m,relative_humidity_2m&timezone=auto`;

        const response = await fetch(apiUrl);
        if (!response.ok) throw new Error(`OpenMeteo Archive API error: ${response.statusText}`);
        const data = await response.json();

        weatherCache.historical.set(cacheKey, { data, timestamp: Date.now() });

        if (weatherCache.historical.size > 100) {
            const firstKey = weatherCache.historical.keys().next().value;
            weatherCache.historical.delete(firstKey);
        }

        res.json(data);
    } catch (error) {
        console.error('Error fetching historical weather:', error);
        res.status(500).json({ error: 'Failed to fetch historical weather data' });
    }
});

export default router;