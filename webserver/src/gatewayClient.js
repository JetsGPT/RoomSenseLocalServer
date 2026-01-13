import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { fileURLToPath } from 'url';
import https from 'https';

// Helper to get directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IDENTITY_FILE = path.join(__dirname, '../server_identity.json'); //this is only for testing purposes
const GATEWAY_URL = process.env.GATEWAY_URL || 'wss://proxy.roomsense.info:8443/ws/gateway';
const LOCAL_API_URL = 'https://localhost:8081'; // Where Express is running locally

function getIdentity() {
    if (fs.existsSync(IDENTITY_FILE)) {
        try {
            const data = JSON.parse(fs.readFileSync(IDENTITY_FILE, 'utf8'));
            return {
                box_id: data.server_id || data.box_id || null,
                password: data.password || data.claim_password || null
            };
        } catch (e) {
            console.error("[Gateway] Failed to read identity file:", e);
        }
    }
    return { box_id: null, password: null };
}

function saveIdentity(boxId, claimPassword = null) {
    let existing = {};
    if (fs.existsSync(IDENTITY_FILE)) {
        try {
            existing = JSON.parse(fs.readFileSync(IDENTITY_FILE, 'utf8'));
        } catch (e) {
            console.error("[Gateway] Failed to read existing identity file:", e);
        }
    }

    const toSave = {
        ...existing,
        server_id: boxId,
        box_id: boxId
    };

    if (claimPassword) {
        toSave.claim_password = claimPassword;
        toSave.password = claimPassword;
    }

    fs.writeFileSync(IDENTITY_FILE, JSON.stringify(toSave, null, 2));
    console.log(`[Gateway] 🆔 Identity saved: ${boxId}${claimPassword ? ' (with claim password)' : ''}`);
}

export function startGatewayClient() {
    console.log(`[Gateway] Connecting to ${GATEWAY_URL}...`);

    const ws = new WebSocket(GATEWAY_URL, {
        rejectUnauthorized: false
    });

    ws.on('open', () => {
        const identity = getIdentity();
        console.log(`[Gateway] Connected. Identifying as: ${identity.box_id || 'New Server'}`);

        ws.send(JSON.stringify({
            type: 'IDENTIFY',
            box_id: identity.box_id,
            password: identity.password
        }));
    });

    ws.on('message', async (data) => {
        let msg;
        try {
            msg = JSON.parse(data);
        } catch (e) { return; }

        if (msg.type === 'REGISTERED') {
            const boxId = msg.payload?.box_id;
            const claimPassword = msg.payload?.claim_password;
            if (boxId) {
                saveIdentity(boxId, claimPassword);
                console.log(`[Gateway] ✅ Registered as: ${boxId}${claimPassword ? ' (claim password received)' : ''}`);
            }
            return;
        }

        if (msg.type === 'PROVISION') {
            const boxId = msg.payload?.box_id;
            if (boxId) {
                saveIdentity(boxId);
                console.log(`[Gateway] ✅ Provisioned as: ${boxId}`);
            }
            return;
        }

        if (msg.type === 'REQUEST') {
            const { request_id, method, path, headers, body, query } = msg;
            console.log(`[Gateway] 📥 Received ${method} ${path}`);

            try {
                const agent = new https.Agent({
                    rejectUnauthorized: false
                });

                const response = await axios({
                    method: method,
                    url: `${LOCAL_API_URL}${path}`,
                    headers: headers,
                    data: body,
                    params: new URLSearchParams(query),
                    validateStatus: () => true,
                    httpsAgent: agent 
                });

                ws.send(JSON.stringify({
                    type: 'RESPONSE',
                    request_id: request_id,
                    payload: {
                        status: response.status,
                        headers: response.headers,
                        body: response.data
                    }
                }));
                console.log(`[Gateway] 📤 Replied ${response.status}`);

            } catch (error) {
                console.error(`[Gateway] Forwarding Error:`, error.message);

                ws.send(JSON.stringify({
                    type: 'RESPONSE',
                    request_id: request_id,
                    payload: {
                        status: 502,
                        body: { error: "Local forwarding failed", details: error.message }
                    }
                }));
            }
        }
    });

    ws.on('close', () => {
        console.log('[Gateway] Disconnected. Retrying in 5s...');
        setTimeout(startGatewayClient, 5000);
    });

    ws.on('error', (err) => {
        console.error('[Gateway] Connection Error:', err.message);
    });
}