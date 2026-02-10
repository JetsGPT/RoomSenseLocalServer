import express from 'express';
import { DEFAULT_LOCATION } from '../config/weatherConfig.js';

// ... (keep express import) ...

const router = express.Router();

// Simple in-memory cache
let weatherCache = {
    current: null,
    historical: new Map(), // Key: "lat,lon,start,end", Value: { data, timestamp }
};

const CACHE_DURATION = 15 * 60 * 1000; // 15 minutes for current
const HISTORICAL_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours for historical (it changes rarely)

// Helper to check cache
const getCachedData = (cache, key, duration) => {
    if (cache.has(key)) {
        const entry = cache.get(key);
        if (Date.now() - entry.timestamp < duration) {
            return entry.data;
        }
    }
    return null;
};

// ... current weather code ...
router.get('/current', async (req, res) => {
    try {
        const { latitude = DEFAULT_LOCATION.latitude, longitude = DEFAULT_LOCATION.longitude } = req.query;
        // ... rest of current logic ...
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

router.get('/historical', async (req, res) => {
    try {
        const {
            latitude = DEFAULT_LOCATION.latitude,
            longitude = DEFAULT_LOCATION.longitude,
            start_date,
            end_date
        } = req.query;

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
        // https://archive-api.open-meteo.com/v1/archive
        const apiUrl = `https://archive-api.open-meteo.com/v1/archive?latitude=${latitude}&longitude=${longitude}&start_date=${start_date}&end_date=${end_date}&hourly=temperature_2m,relative_humidity_2m&timezone=auto`;

        const response = await fetch(apiUrl);
        if (!response.ok) throw new Error(`OpenMeteo Archive API error: ${response.statusText}`);
        const data = await response.json();

        // transform to friendly format if needed, or keep raw
        // Keeping raw OpenMeteo structure is fine for now, frontend adapters can handle it.

        weatherCache.historical.set(cacheKey, { data, timestamp: Date.now() });

        // Prune cache if too large? 
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
