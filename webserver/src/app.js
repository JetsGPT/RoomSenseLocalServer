import express from 'express';
import cors from 'cors';
import session from "express-session";
import pg from "pg";
import connectPgSimple from "connect-pg-simple";

import https from 'https';
import fs from 'fs';
import cookieParser from 'cookie-parser';
import csurf from 'csurf';
import ratePermissions from './middleware/ratePermissions.js';
import { loadEnvironment } from './loadSecrets.js';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables from .env file and Docker Swarm secrets
loadEnvironment();


// Session sachen
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STATIC_BUILD_FOLDER = path.join(__dirname, 'public');
const STATIC_INDEX_FILE = path.join(STATIC_BUILD_FOLDER, 'index.html');
const STATIC_ASSETS_FOLDER = path.join(STATIC_BUILD_FOLDER, 'assets');
const IMMUTABLE_ASSET_PATTERN = /-[A-Za-z0-9_-]{6,}\.(?:js|css|mjs|map|svg|png|jpg|jpeg|gif|webp|ico)$/i;
const ROOT_CA_SECRET_PATH = '/run/secrets/ssl_root_ca';

const { Pool } = pg;
const PgSession = connectPgSimple(session);

// Read password directly from Docker secret file to ensure exact match with postgres
// This avoids any potential issues with process.env or trimming
let dbPassword = process.env.PGPASSWORD;
if (!dbPassword) {
    // Fallback to reading file manually if process.env failed (should be covered by loadSecrets, but keeping for safety)
    // But NEVER fallback to "password"
}
try {
    const secretPath = '/run/secrets/pgpassword';
    if (fs.existsSync(secretPath)) {
        const secret = fs.readFileSync(secretPath, 'utf8')
            .replace(/\r\n/g, '')
            .replace(/\n/g, '')
            .replace(/\r/g, '');
        if (secret) {
            dbPassword = secret;
            console.log(`✓ Using PostgreSQL password from Docker secret file (Length: ${dbPassword.length}, Prefix: ${dbPassword.substring(0, 3)}***)`);
        }
    }
} catch (error) {
    console.warn(`⚠️  Could not read PostgreSQL secret file, using process.env.PGPASSWORD: ${error.message}`);
}


const pool = new Pool({
    user: process.env.PGUSER || "postgres",
    password: dbPassword,
    host: process.env.PGHOST || "postgres",
    port: process.env.PGPORT ? parseInt(process.env.PGPORT) : 5432,
    database: process.env.PGDATABASE || "user",
});

// Helper: Wait for Database to be ready (handling DNS/Network startup delays)
async function waitForDatabase(pool, maxRetries = 15, delayMs = 2000) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            await pool.query('SELECT 1');
            console.log('✅ PostgreSQL is reachable.');
            return;
        } catch (err) {
            console.log(`⏳ Waiting for PostgreSQL (Attempt ${i + 1}/${maxRetries})... Error: ${err.message}`);
            await new Promise(res => setTimeout(res, delayMs));
        }
    }
    console.error('❌ Could not connect to PostgreSQL after multiple attempts.');
    process.exit(1);
}

async function ensureBaselineAnonymousPermissions(pool) {
    const rules = [
        ['anonymous', '*', '/','prefix', false, 0, 0],
        ['anonymous', 'POST', '/api/users/register', 'exact', true, 10, 60000],
        ['anonymous', 'POST', '/api/users/login', 'exact', true, 20, 60000],
        ['anonymous', 'GET', '/api/setup/bootstrap', 'exact', true, 60, 60000],
        ['anonymous', 'POST', '/api/setup/initial-account', 'exact', true, 10, 60000],
    ];

    try {
        await pool.query('INSERT INTO public.roles(name) VALUES($1) ON CONFLICT (name) DO NOTHING', ['anonymous']);

        for (const [role, method, pathPattern, matchType, allow, rateLimitMax, rateLimitWindowMs] of rules) {
            await pool.query(
                `INSERT INTO public.permissions(role, method, path_pattern, match_type, allow, rate_limit_max, rate_limit_window_ms)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 ON CONFLICT (role, method, path_pattern, match_type) DO NOTHING`,
                [role, method, pathPattern, matchType, allow, rateLimitMax, rateLimitWindowMs]
            );
        }
    } catch (error) {
        console.warn('[Startup] Failed to ensure baseline anonymous permissions:', error.message || error);
    }
}

// Block startup until DB is ready
await waitForDatabase(pool);
await ensureBaselineAnonymousPermissions(pool);

//---------




const app = express();
const PORT = 8081;

import userRouter from './routes/users.js';
import sensorRouter from './routes/sensors/index.js';
import testingRouter from './routes/testing.js';
import deviceRouter, { initDatabasePool, restorePersistedConnections } from './routes/devices.js';
import floorPlansRouter, { initDatabasePool as initFloorPlansPool } from './routes/floorPlans.js';
import weatherRouter from './routes/weather.js';
import notificationRouter from './routes/notifications.js';
import aiRouter from './routes/ai.js';
import settingsRouter from './routes/settings.js';
import setupRouter from './routes/setup.js';
import systemRouter from './routes/system.js';
import ruleEngine from './services/notifications/RuleEngine.js';
import sensorDataService from './services/SensorDataService.js';
import aiService from './services/AiService.js';
import { startGatewayClient } from "./gatewayClient.js";
app.use(express.json());

// Make pool available to middlewares
app.locals.pool = pool;
app.locals.hasFrontendBuild = () => fs.existsSync(STATIC_INDEX_FILE);

if (!app.locals.hasFrontendBuild()) {
    console.warn(`[Static] Frontend build missing at ${STATIC_INDEX_FILE}`);
}

function setStaticCacheHeaders(res, filePath) {
    const fileName = path.basename(filePath);

    if (fileName === 'index.html' || filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        return;
    }

    if (IMMUTABLE_ASSET_PATTERN.test(fileName)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        return;
    }

    res.setHeader('Cache-Control', 'public, max-age=3600');
}

// Optionally trust proxy for correct client IPs
if (process.env.RATE_LIMIT_TRUST_PROXY === '1' || process.env.TRUST_PROXY === '1') {
    app.set('trust proxy', 1);
}
app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);

        // Allow localhost, local network IPs, and your domain
        const allowedOrigins = [
            'http://localhost:5173',
            'https://localhost:5173',
            'http://127.0.0.1:5173',
            'https://127.0.0.1:5173',
            'https://server.roomsense.duckdns.org',
            'https://roomsense.duckdns.org',
            'https://influxdb.roomsense.duckdns.org',
            'http://server.roomsense.duckdns.org',
            /^https?:\/\/192\.168\.\d+\.\d+:5173$/,  // Allow any 192.168.x.x IP
            /^https?:\/\/10\.\d+\.\d+\.\d+:5173$/,   // Allow any 10.x.x.x IP  
            /^https?:\/\/172\.(1[6-9]|2[0-9]|3[0-1])\.\d+\.\d+:5173$/, // Allow 172.16-31.x.x IPs
            'capacitor://localhost',
            'ionic://localhost',
            'https://localhost',
            'https://roomsense.local',
            'https://roomsense.info',
            'https://proxy.roomsense.info',
            'https://100.76.205.69' // nur Vorübergehend für Tailscale
        ];

        const isAllowed = allowedOrigins.some(allowedOrigin => {
            if (typeof allowedOrigin === 'string') {
                return origin === allowedOrigin;
            } else if (allowedOrigin instanceof RegExp) {
                return allowedOrigin.test(origin);
            }
            return false;
        });

        if (isAllowed) {
            callback(null, true);
        } else {
            console.log('CORS blocked origin:', origin);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    optionsSuccessStatus: 200
}));

app.get('/ca.crt', (req, res) => {
    if (!fs.existsSync(ROOT_CA_SECRET_PATH)) {
        return res.status(404).type('text/plain').send('RoomSense root certificate is not available.');
    }

    res.download(ROOT_CA_SECRET_PATH, 'roomsense-rootCA.crt');
});



app.use(express.static(STATIC_BUILD_FOLDER, {
    index: false,
    setHeaders: setStaticCacheHeaders
}));
// session
// app.set('trust proxy', 1);
app.use(
    session({
        store: new PgSession({
            pool,
            tableName: "session", createTableIfMissing: true, // wenn sie nicht existiert wird sie automatisch erstellt
            pruneSessionInterval: 60 * 60
        }),
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
            maxAge: 1000 * 60 * 60 * 2,
            secure: true,
            httpOnly: true,
            sameSite: "none",  // Required for cross-origin requests


        },
    })
);

app.use(cookieParser());

// CSRF Protection
// We exclude the sensors data writing endpoint if it's being hit by a non-browser device that can't handle CSRF
// But since it currently requires login (Session), valid clients must handle cookies anyway.
// But since it currently requires login (Session), valid clients must handle cookies anyway.
const csrfProtection = csurf({
    cookie: {
        secure: true,
        sameSite: 'none',
        httpOnly: true
    }
});

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Apply CSRF to state-changing API routes only.
app.use('/api', (req, res, next) => {
    const skipPaths = ['/health', '/devices/health', '/sensors', '/sensors/'];
    if (SAFE_METHODS.has(req.method) || skipPaths.includes(req.path)) return next();
    csrfProtection(req, res, next);
});

// CSRF Token endpoint
app.get('/api/csrf-token', csrfProtection, (req, res) => {
    res.json({ csrfToken: req.csrfToken() });
});


// Serve static files (React app) - Place this before rate limiter/auth so assets load freely

// Apply DB-backed permissions and rate limiting ONLY to API routes, EXCLUDING health endpoints
app.use('/api', (req, res, next) => {
    const skipPaths = ['/health', '/devices/health', '/sensors', '/sensors/'];
    if (skipPaths.includes(req.path)) return next();
    ratePermissions()(req, res, next);
});

// Generic Health Check (for Docker/K8s/Load Balancers)
app.get('/api/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        frontendBuildPresent: app.locals.hasFrontendBuild(),
    });
});

// Initialize database pool for device router and floor plans router
initDatabasePool(pool);
initFloorPlansPool(pool);

// Initialize rule engine for notifications
ruleEngine.initialize(pool);

// Initialize AI services
sensorDataService.initialize(pool);
aiService.initialize(pool);

app.use('/api/users', userRouter);
app.use('/api/sensors', sensorRouter);
app.use('/api/devices', deviceRouter);
app.use('/api/floor-plans', floorPlansRouter);
app.use('/api/weather', weatherRouter);
app.use('/api/notifications', notificationRouter);
app.use('/api/ai', aiRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/setup', setupRouter);
app.use('/api/system', systemRouter);
if (process.env.NODE_ENV === 'development') {
    app.use('/testing', testingRouter);
    console.log('⚠️  Testing routes enabled (development mode only)');
}


app.get('/assets/*', (req, res) => {
    const requestedAsset = req.params[0] || '';
    const resolvedAssetPath = path.resolve(STATIC_ASSETS_FOLDER, requestedAsset);
    const assetsRoot = `${STATIC_ASSETS_FOLDER}${path.sep}`;

    if (!requestedAsset || (resolvedAssetPath !== STATIC_ASSETS_FOLDER && !resolvedAssetPath.startsWith(assetsRoot))) {
        return res.status(400).type('text/plain').send('Invalid asset path.');
    }

    if (!fs.existsSync(resolvedAssetPath)) {
        return res.status(404).type('text/plain').send('Static asset not found.');
    }

    setStaticCacheHeaders(res, resolvedAssetPath);
    res.sendFile(resolvedAssetPath);
});

app.get('*', (req, res) => {
    if (!app.locals.hasFrontendBuild()) {
        return res.status(503).type('text/plain').send('Frontend build is missing from the backend static directory.');
    }

    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(STATIC_INDEX_FILE);
});

// Error handler for CSRF
app.use((err, req, res, next) => {
    if (err.code === 'EBADCSRFTOKEN') {
        return res.status(403).json({ error: 'Invalid or missing CSRF token' });
    }
    next(err);
});



// SSL certificate configuration
let httpsOptions;
try {
    httpsOptions = {
        key: fs.readFileSync('/run/secrets/ssl_server_key'),
        cert: fs.readFileSync('/run/secrets/ssl_server_cert'),
    };
} catch (error) {
    console.error('⚠️  SSL secrets not found in /run/secrets/');
    console.error('   Ensure Docker Swarm secrets ssl_server_key and ssl_server_cert are initialized.');
    process.exit(1);
}

https.createServer(httpsOptions, app).listen(PORT, '0.0.0.0', async () => {
    console.log(`✅ HTTPS Server running on https://0.0.0.0:${PORT}`);
    console.log(`🌐 Access from local network: https://[RASPBERRY_PI_IP]:${PORT}`);
    console.log('-----------------------------------');
    console.log('🚀 Starting Remote Access Gateway...');
    startGatewayClient();
    console.log('-----------------------------------');
    console.log('🔔 Starting Notification Rule Engine...');
    ruleEngine.start();
    console.log('-----------------------------------');
    // Restore persisted BLE connections after server starts
    // Wait a bit for the BLE gateway to be ready
    setTimeout(async () => {
        await restorePersistedConnections();
    }, 3000); // Wait 3 seconds for services to be ready
});



// --- HTTP → HTTPS redirect ---
//http.createServer((req, res) => {
//   const host = req.headers['host']?.replace(/:\d+$/, ''); // remove port if present
//    res.writeHead(301, { "Location": "https://" + host + req.url });
//  res.end();
//}).listen(80, () => {
// console.log('ℹ️ HTTP Server redirecting to HTTPS on port 80');
//});
