import aiService from './src/services/AiService.js';
import sensorDataService from './src/services/SensorDataService.js';

// Mock sensor data
sensorDataService.getActiveDevices = async () => ({ success: true, data: [{ display_name: 'Living Room', box_id: 'box1' }] });
sensorDataService.getAvailableSensorTypes = async () => ({ success: true, data: ['temperature', 'humidity'] });
sensorDataService.getLatestReading = async () => ({ success: true, data: { value: 22, unit: 'C' } });

async function run() {
    process.env.GEMINI_API_KEY = "dummy_key_for_test";
    await aiService.initialize();
    
    try {
        console.log("Testing chat with history...");
        const res = await aiService.chat("What is the temperature in the living room?", [{role: "user", parts: [{text: "Hello!"}]}], 1);
        console.log("Result:", res);
    } catch (e) {
        console.error("EXPECTED OR UNEXPECTED ERROR:", e.message);
    }
}
run();
