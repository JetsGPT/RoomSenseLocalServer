import express from 'express';
import cors from 'cors';
import session from "express-session";
import pg from "pg";
import connectPgSimple from "connect-pg-simple";
import dotenv from "dotenv";
import https from 'https';
import fs from 'fs';

dotenv.config();


// Session sachen

const { Pool } = pg;
const PgSession = connectPgSimple(session);

const pool = new Pool({
    user: process.env.PGUSER || "postgres",
    password: process.env.PGPASSWORD || "password",
    host: process.env.PGHOST || "postgres",
    port: process.env.PGPORT ? parseInt(process.env.PGPORT) : 5432,
    database: process.env.PGDATABASE || "user",
});

//---------




const app = express();
const PORT = 8081   ;

import userRouter from './routes/users.js';
import sensorRouter from './routes/sensors/index.js';
import testingRouter from './routes/testing.js';

// session

app.use(
    session({
        store: new PgSession({
            pool,
            tableName: "session",createTableIfMissing: true, // wenn sie nicht existiert wird sie automatisch erstellt
            pruneSessionInterval: 60*60
        }),
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
            maxAge: 1000 * 60 * 60 * 2, 
            secure: true,
            httpOnly: true,
            sameSite: "none"  // Required for cross-origin requests with IP addresses
        },
    })
);



app.use(express.json());
app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        
        // Allow localhost and local network IPs
        const allowedOrigins = [
            'http://localhost:5173',
            'https://localhost:5173',
            /^https?:\/\/192\.168\.\d+\.\d+:5173$/,  // Allow any 192.168.x.x IP
            /^https?:\/\/10\.\d+\.\d+\.\d+:5173$/,   // Allow any 10.x.x.x IP  
            /^https?:\/\/172\.(1[6-9]|2[0-9]|3[0-1])\.\d+\.\d+:5173$/ // Allow 172.16-31.x.x IPs
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
app.use('/api/users', userRouter);
app.use('/api/sensors', sensorRouter);
app.use('/testing', testingRouter);



const httpsOptions = {
    key: fs.readFileSync('./server.key'),
    cert: fs.readFileSync('./server.cert'),
};

https.createServer(httpsOptions, app).listen(PORT, '0.0.0.0', () => {
    console.log(`✅ HTTPS Server running on https://0.0.0.0:${PORT}`);
    console.log(`🌐 Access from local network: https://[RASPBERRY_PI_IP]:${PORT}`);
});



// --- HTTP → HTTPS redirect ---
//http.createServer((req, res) => {
 //   const host = req.headers['host']?.replace(/:\d+$/, ''); // remove port if present
//    res.writeHead(301, { "Location": "https://" + host + req.url });
  //  res.end();
//}).listen(80, () => {
   // console.log('ℹ️ HTTP Server redirecting to HTTPS on port 80');
//});