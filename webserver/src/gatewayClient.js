import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { fileURLToPath } from 'url';

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
            return data.server_id;
        } catch (e) {
            console.error("Failed to read identity file:", e);
        }
    }
    return null;
}

function saveIdentity(id) {
    fs.writeFileSync(IDENTITY_FILE, JSON.stringify({ server_id: id }, null, 2));
    console.log(`[Gateway] 🆔 Assigned new Identity: ${id}`);
}

export function startGatewayClient() {
    console.log(`[Gateway] Connecting to ${GATEWAY_URL}...`);


    ws.on('open', () => {
        const myId = getIdentity();
        console.log(`[Gateway] Connected. Identifying as: ${myId || 'New Server'}`);

        ws.send(JSON.stringify({
            type: 'IDENTIFY',
            box_id: myId
        }));
    });

    ws.on('message', async (data) => {
        let msg;
        try {
            msg = JSON.parse(data);
        } catch (e) { return; }

        if (msg.type === 'PROVISION') {
            saveIdentity(msg.payload.server_id);
            return;
        }

        if (msg.type === 'REQUEST') {
            const { request_id, method, path, headers, body, query } = msg;
            console.log(`[Gateway] 📥 Received ${method} ${path}`);

            try {

                const response = await axios({
                    method: method,
                    url: `${LOCAL_API_URL}${path}`,
                    headers: headers,
                    data: body,
                    params: new URLSearchParams(query),
                    validateStatus: () => true
                });

                // Send Result back to Cloud
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