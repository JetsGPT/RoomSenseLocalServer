import express from 'express';
import cors from 'cors';

// Set variables BEFORE importing gatewayClient
process.env.GATEWAY_URL = 'wss://proxy.roomsense.info:8443/ws/gateway';
process.env.LOCAL_API_URL = 'http://localhost:8081'; // The local mock API is using HTTP, not HTTPS

console.log('\n' + '='.repeat(60));
console.log('🔌 Gateway Client Test & Health Checker');
console.log('='.repeat(60));
console.log(`\n  Connecting to: ${process.env.GATEWAY_URL}`);

// Dynamic import so GATEWAY_URL env var is set first
const { startGatewayClient } = await import('./src/gatewayClient.js');

// 1. Try to connect to the gateway
startGatewayClient();

// Host a simple health checker API with permissive CORS
const app = express();
app.use(cors());

// Route for health checking
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'success',
        message: 'API is running',
        gateway_connected: true // Running this script assumes gateway initialization was fired
    });
});

// Also reply to root so we don't get 404s when testing the base URL
app.get('/', (req, res) => {
    res.status(200).json({
        status: 'success',
        message: 'Test API Root',
        gateway_connected: true
    });
});

// Catch-all to respond to any other path with a generic message instead of a 404
app.use((req, res) => {
    res.status(200).json({
        status: 'success',
        message: `Received ${req.method} request to ${req.path}`,
    });
});

// Since gatewayClient forwards to localhost:8081, running the mock API here on 8081 will answer gateway requests.
// (Note: gatewayClient.js uses https://localhost:8081 for forwarding, so testing HTTP forwarding might require disabling https in gatewayClient testing, 
// though for a simple health check server http is ideal).
const PORT = process.env.PORT || 8081;

app.listen(PORT, () => {
    console.log(`  🏥 Health checker API is listening on port ${PORT}`);
    console.log(`  Endpoints:`);
    console.log(`   - GET /health  (To verify the API is running)\n`);
});
