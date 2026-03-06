import { GoogleGenAI, Type, HarmCategory, HarmBlockThreshold } from '@google/genai';

console.log("Type:", Type);
console.log("HarmCategory:", HarmCategory);
console.log("HarmBlockThreshold:", HarmBlockThreshold);

// Check the specific values used in AiService
console.log("\nValues used in AiService:");
console.log("HARM_CATEGORY_HARASSMENT:", HarmCategory?.HARM_CATEGORY_HARASSMENT);
console.log("HARM_CATEGORY_HATE_SPEECH:", HarmCategory?.HARM_CATEGORY_HATE_SPEECH);
console.log("HARM_CATEGORY_SEXUALLY_EXPLICIT:", HarmCategory?.HARM_CATEGORY_SEXUALLY_EXPLICIT);
console.log("HARM_CATEGORY_DANGEROUS_CONTENT:", HarmCategory?.HARM_CATEGORY_DANGEROUS_CONTENT);
console.log("BLOCK_MEDIUM_AND_ABOVE:", HarmBlockThreshold?.BLOCK_MEDIUM_AND_ABOVE);
