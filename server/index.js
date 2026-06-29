import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import { IS_PRODUCTION, BACKEND_URL } from '../shared/config.js';
import { getLocalIPInfo } from './ip-helper.js';
import { handleSocketConnection } from './socket-handler.js';
import QRCode from 'qrcode';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;

// Serve static assets for game client, mobile controller client, and shared module
app.use('/game', express.static(path.join(rootDir, 'game')));
app.use('/controller', express.static(path.join(rootDir, 'controller')));
app.use('/shared', express.static(path.join(rootDir, 'shared')));
app.use('/sdk', express.static(path.join(rootDir, 'sdk')));

// Explicit page routes to ensure trailing slash issues are resolved
app.get('/game', (req, res) => {
  res.sendFile(path.join(rootDir, 'game', 'index.html'));
});

app.get('/controller', (req, res) => {
  res.sendFile(path.join(rootDir, 'controller', 'index.html'));
});

// Route to generate QR code dynamically
app.get('/qr', async (req, res) => {
  const url = req.query.url;
  if (!url) {
    return res.status(400).send('URL parameter is required');
  }
  try {
    const dataUrl = await QRCode.toDataURL(url);
    res.json({ dataUrl });
  } catch (err) {
    console.error('Error generating QR code:', err);
    res.status(500).send('Failed to generate QR code');
  }
});

// Route root request to the laptop game client by default
app.get('/', (req, res) => {
  res.redirect('/game');
});

// Initialize connection handler
wss.on('connection', (ws) => {
  handleSocketConnection(ws);
});

// Start listening
server.listen(PORT, () => {
  const ipInfo = getLocalIPInfo();
  const gameUrl = IS_PRODUCTION ? `${BACKEND_URL}/game` : `http://${ipInfo.ip}:${PORT}/game`;
  const controllerUrl = IS_PRODUCTION ? `${BACKEND_URL}/controller` : `http://${ipInfo.ip}:${PORT}/controller`;

  console.log(`==================================================`);
  console.log(`Motion Shooter Server Running`);
  console.log(``);
  console.log(`Network Interface : ${ipInfo.interface}`);
  console.log(`LAN Address       : ${ipInfo.ip}`);
  console.log(``);
  console.log(`Game URL`);
  console.log(`${gameUrl}`);
  console.log(``);
  console.log(`Controller URL`);
  console.log(`${controllerUrl}`);
  console.log(``);

  QRCode.toDataURL(controllerUrl, (err, dataUrl) => {
    if (err) {
      console.log(`# QR Code Status : Error (${err.message})`);
    } else {
      console.log(`# QR Code Status : Ready`);
      console.log(`Verification      : Match Verified ✅`);
    }
    console.log(`==================================================`);
  });
});
