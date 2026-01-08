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

// Block startup until DB is ready
await waitForDatabase(pool);

//---------




const app = express();
const PORT = 8081;

import userRouter from './routes/users.js';
import sensorRouter from './routes/sensors/index.js';
import testingRouter from './routes/testing.js';
import deviceRouter, { initDatabasePool, restorePersistedConnections } from './routes/devices.js';
import { startGatewayClient } from "./gatewayClient.js";
app.use(express.json());
// Make pool available to middlewares
app.locals.pool = pool;

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
            'https://proxy.roomsense.info'
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



app.use(express.static(STATIC_BUILD_FOLDER));
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

// Apply CSRF to all API routes, EXCLUDING health endpoints
app.use('/api', (req, res, next) => {
    const skipPaths = ['/health', '/devices/health', '/sensors', '/sensors/'];
    if (skipPaths.includes(req.path)) return next();
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
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Initialize database pool for device router
initDatabasePool(pool);

app.use('/api/users', userRouter);
app.use('/api/sensors', sensorRouter);
app.use('/api/devices', deviceRouter);
if (process.env.NODE_ENV === 'development') {
    app.use('/testing', testingRouter);
    console.log('⚠️  Testing routes enabled (development mode only)');
}


app.get('*', (req, res) => {
    res.sendFile(path.join(STATIC_BUILD_FOLDER, 'index.html'));
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