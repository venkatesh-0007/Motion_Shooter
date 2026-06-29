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

  // Vercel expects a 'public' output directory by default when a build script is present.
  // We will copy all the static folders into 'public' so Vercel can serve them.
  const publicDir = path.join(__dirname, '..', 'public');
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir);
  }
  
  const foldersToCopy = ['game', 'controller', 'shared', 'sdk'];
  for (const folder of foldersToCopy) {
    const src = path.join(__dirname, '..', folder);
    const dest = path.join(publicDir, folder);
    if (fs.existsSync(src)) {
      fs.cpSync(src, dest, { recursive: true });
    }
  }

  // Create a root index.html to automatically redirect visitors to the game
  const rootIndex = path.join(publicDir, 'index.html');
  fs.writeFileSync(rootIndex, '<meta http-equiv="refresh" content="0; url=/game/" />');
  
  console.log('Successfully prepared the "public" directory for Vercel deployment.');

} else {
  console.log('Not running in Vercel, skipping environment injection.');
}
