import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const configPath = path.join(__dirname, '..', 'shared', 'config.js');

if (process.env.VERCEL) {
  console.log('Vercel environment detected. Injecting environment variables...');
  
  const backendUrl = process.env.BACKEND_URL;
  if (!backendUrl) {
    console.error('ERROR: BACKEND_URL environment variable is missing in Vercel!');
    process.exit(1);
  }

  // Ensure wsUrl relies on secure wss protocol if https is provided
  const wsUrl = backendUrl.replace(/^http/, 'ws');

  // Replace the entire dynamic file with a static production version for the frontend browser
  const staticConfig = `
export const IS_PRODUCTION = true;
export const BACKEND_URL = "${backendUrl}";
export const WS_URL = "${wsUrl}";
  `;
  
  fs.writeFileSync(configPath, staticConfig.trim());
  console.log(`Successfully injected BACKEND_URL: ${backendUrl}`);
} else {
  console.log('Not running in Vercel, skipping environment injection.');
}
