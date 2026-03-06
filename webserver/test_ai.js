import { GoogleGenerativeAI } from '@google/generative-ai';
import aiService from './src/services/AiService.js';

// Mock sensor data service
import sensorDataService from './src/services/SensorDataService.js';
sensorDataService.getActiveDevices = async () => ({ success: true, data: [{ display_name: 'Living Room', box_id: 'box1' }] });
sensorDataService.getAvailableSensorTypes = async () => ({ success: true, data: ['temperature', 'humidity'] });

async function test() {
    console.log("Initializing...");
    process.env.GEMINI_API_KEY = "test_key";
    await aiService.initialize();
    
    try {
        console.log("Calling chat...");
        const res = await aiService.chat("Hello test", [], 1);
        console.log("Success", res);
    } catch (e) {
        console.error("Caught error:", e.message, "\nStack:", e.stack);
    }
}
test();
