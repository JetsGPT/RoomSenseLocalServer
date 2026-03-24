/**
 * Gateway Client Test Runner
 * Runs the ACTUAL gatewayClient.js against a mock server on ws://localhost:9999
 * 
 * Usage:
 *   1. Start the mock server first:  python test_gateway.py  (in OutsideServer)
 *   2. Then run this:                node test_gateway_client.mjs
 */

// Set GATEWAY_URL BEFORE importing gatewayClient (uses dynamic import below)
process.env.GATEWAY_URL = 'ws://localhost:9999/ws/gateway';

console.log('\n' + '='.repeat(60));
console.log('🔌 Gateway Client Test (using real gatewayClient.js)');
console.log('='.repeat(60));
console.log(`\n  Connecting to: ${process.env.GATEWAY_URL}`);
console.log('  Make sure the mock server (test_gateway.py) is running!\n');

// Dynamic import so GATEWAY_URL env var is set first
const { startGatewayClient } = await import('./src/gatewayClient.js');

startGatewayClient();

// Auto-exit after 10 seconds
setTimeout(() => {
    console.log('\n  🏁 Test window complete — exiting.');
    process.exit(0);
}, 10000);
