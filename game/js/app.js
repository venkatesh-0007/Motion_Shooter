import { CONNECTION_STATES } from '/shared/constants.js';
import { GameConnection } from './connection.js';

// DOM Elements
const lobbyScreen = document.getElementById('lobby-screen');
const gameContainer = document.getElementById('game-container');
const qrImage = document.getElementById('qr-image');
const controllerUrlSpan = document.getElementById('controller-url');
const scoreVal = document.getElementById('score-val');

// Calibration inputs
const sensSlider = document.getElementById('sens-slider');
const sensVal = document.getElementById('sens-val');
const smoothSlider = document.getElementById('smooth-slider');
const smoothVal = document.getElementById('smooth-val');
const deadzoneSlider = document.getElementById('deadzone-slider');
const deadzoneVal = document.getElementById('deadzone-val');

// Game states
let score = 0;
let isConnected = false;
let canvas, ctx;
let targets = [];
let particles = [];
const MAX_TARGETS = 3;

// Crosshair & Calibration values
const crosshair = { x: 0, y: 0, targetX: 0, targetY: 0, radius: 15, shootPulse: 0 };
let referenceOrientation = null;
let currentOrientation = { alpha: 0, beta: 0, gamma: 0 };

// Control configurations (bind directly to sliders)
let sensitivity = parseFloat(sensSlider.value);
let smoothing = parseFloat(smoothSlider.value);
let deadZone = parseFloat(deadzoneSlider.value);

// Listeners for sliders to update variables live
sensSlider.addEventListener('input', (e) => {
  sensitivity = parseFloat(e.target.value);
  sensVal.textContent = e.target.value;
});

smoothSlider.addEventListener('input', (e) => {
  smoothing = parseFloat(e.target.value);
  smoothVal.textContent = e.target.value;
});

deadzoneSlider.addEventListener('input', (e) => {
  deadZone = parseFloat(e.target.value);
  deadzoneVal.textContent = e.target.value;
});

/**
 * Calculates the shortest angular distance between two angles in degrees.
 * Handles the 360 wrap-around.
 */
function getAngleDifference(current, reference) {
  let diff = current - reference;
  while (diff < -180) diff += 360;
  while (diff > 180) diff -= 360;
  return diff;
}

/**
 * Renders the QR code for mobile controller access.
 */
async function generateLobbyQR() {
  const controllerUrl = `${window.location.protocol}//${window.location.host}/controller/`;
  controllerUrlSpan.textContent = controllerUrl;

  try {
    const response = await fetch(`/qr?url=${encodeURIComponent(controllerUrl)}`);
    const data = await response.json();
    if (qrImage) {
      qrImage.src = data.dataUrl;
    }
  } catch (err) {
    console.error('Error fetching QR code:', err);
  }
}

/**
 * Handles connection status events.
 * Swaps screens and configures canvas.
 */
let orientationPacketsRecv = 0;
let shootCount = 0;

function handleStatusChange(state) {
  const isConnectedVal = state === CONNECTION_STATES.CONNECTED;
  const debugConnectedEl = document.getElementById('debug-connected');
  if (debugConnectedEl) {
    debugConnectedEl.textContent = isConnectedVal ? 'Yes' : 'No';
  }

  if (isConnectedVal) {
    isConnected = true;
    lobbyScreen.classList.add('hidden');
    gameContainer.classList.remove('hidden');
    
    // Initialise and start canvas game loop
    initCanvas();
    // Reset baseline calibration for initial position
    referenceOrientation = null;
  } else {
    isConnected = false;
    lobbyScreen.classList.remove('hidden');
    gameContainer.classList.add('hidden');
  }
  console.log(`[DESKTOP STATUS] WebSocket Connection State: ${state}`);
}

/**
 * Calibrates current sensor readings as the center baseline.
 */
function recenter() {
  if (currentOrientation) {
    const prevReference = referenceOrientation ? { ...referenceOrientation } : null;
    referenceOrientation = { ...currentOrientation };

    console.log('=== DESKTOP RECENTER SIGNAL RECEIVED ===');
    console.log('Current Orientation Alpha:', currentOrientation.alpha, 'Beta:', currentOrientation.beta, 'Gamma:', currentOrientation.gamma);
    console.log('Stored Baseline (Reference) Alpha:', referenceOrientation.alpha, 'Beta:', referenceOrientation.beta, 'Gamma:', referenceOrientation.gamma);
    if (prevReference) {
      console.log('Delta from Previous Alpha:', getAngleDifference(currentOrientation.alpha, prevReference.alpha), 'Beta:', getAngleDifference(currentOrientation.beta, prevReference.beta));
    }
    console.log('========================================');

    const recvShootEl = document.getElementById('debug-recv-shoot');
    if (recvShootEl) {
      recvShootEl.textContent = `Recenter Recv (${new Date().toLocaleTimeString()})`;
    }
  } else {
    console.warn('[DESKTOP RECENTER] Recenter requested, but currentOrientation is null.');
  }
}

/**
 * Handles incoming WebSocket device orientation packets.
 */
function handleOrientation(alpha, beta, gamma) {
  orientationPacketsRecv++;
  if (orientationPacketsRecv % 60 === 0) {
    console.log(`[DESKTOP ORIENTATION] Recv raw packet #${orientationPacketsRecv}. Alpha: ${alpha}, Beta: ${beta}, Gamma: ${gamma}`);
  }

  // Update debug elements
  const recvPacketsEl = document.getElementById('debug-packets-recv');
  const yawEl = document.getElementById('debug-yaw');
  const pitchEl = document.getElementById('debug-pitch');
  const rollEl = document.getElementById('debug-roll');

  if (recvPacketsEl) recvPacketsEl.textContent = orientationPacketsRecv;
  if (yawEl) yawEl.textContent = alpha.toFixed(2);
  if (pitchEl) pitchEl.textContent = beta.toFixed(2);
  if (rollEl) rollEl.textContent = gamma.toFixed(2);

  currentOrientation = { alpha, beta, gamma };

  if (!canvas) {
    console.warn("[DESKTOP ORIENTATION] Canvas not initialized yet.");
    return;
  }

  if (!referenceOrientation) {
    // Initialize crosshair to center on first packet
    referenceOrientation = { alpha, beta, gamma };
    crosshair.x = canvas.width / 2;
    crosshair.y = canvas.height / 2;
  }

  // Temporarily map orientation directly, ignoring calibration/smoothing
  crosshair.x += gamma * 2;
  crosshair.y += beta * 2;

  // Clamp coordinates within game viewport boundaries
  crosshair.x = Math.max(crosshair.radius, Math.min(canvas.width - crosshair.radius, crosshair.x));
  crosshair.y = Math.max(crosshair.radius, Math.min(canvas.height - crosshair.radius, crosshair.y));
}

/**
 * Triggers explosion debris.
 */
function spawnParticles(x, y, color, count = 12) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 4 + 2;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius: Math.random() * 4 + 2,
      alpha: 1,
      color: color || '#00f2fe',
      decay: Math.random() * 0.02 + 0.015
    });
  }
}

/**
 * Handles incoming trigger signals from the controller.
 */
function handleShoot() {
  if (!isConnected) return;

  shootCount++;
  console.log(`[DESKTOP SHOOT] Recv shoot trigger #${shootCount}`);
  
  const recvShootEl = document.getElementById('debug-recv-shoot');
  if (recvShootEl) {
    recvShootEl.textContent = `Yes (Trigger #${shootCount})`;
  }

  // Apply expansion pulse on crosshair
  crosshair.shootPulse = 1.0;

  // Spawn visual muzzle particles at crosshair pointer
  spawnParticles(crosshair.x, crosshair.y, '#ff007f', 6);

  // Check overlap collision with active targets
  let targetHit = false;
  for (let i = targets.length - 1; i >= 0; i--) {
    const target = targets[i];
    const dx = crosshair.x - target.x;
    const dy = crosshair.y - target.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Overlap condition (crosshair cursor hits circle bounds)
    if (distance < target.radius) {
      targetHit = true;
      
      // Spawn score explosion particles
      spawnParticles(target.x, target.y, target.color, 20);

      // Remove target and spawn replacement
      targets.splice(i, 1);
      spawnSingleTarget();

      // Update score HUD
      score += 100;
      scoreVal.textContent = String(score).padStart(3, '0');
    }
  }

  if (!targetHit) {
    console.log('Miss!');
  }
}

/**
 * Initializes canvas sizes and triggers animation cycles.
 */
function initCanvas() {
  canvas = document.getElementById('game-canvas');
  ctx = canvas.getContext('2d');

  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  // Clear existing targets and generate initial stack
  targets = [];
  for (let i = 0; i < MAX_TARGETS; i++) {
    spawnSingleTarget();
  }

  requestAnimationFrame(gameLoop);
}

function resizeCanvas() {
  if (canvas) {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
}

/**
 * Spawns a new target.
 */
function spawnSingleTarget() {
  const margin = 100;
  const radius = Math.random() * 15 + 20; // 20px - 35px
  const x = Math.random() * (canvas.width - margin * 2) + margin;
  const y = Math.random() * (canvas.height - margin * 2) + margin;

  // Curated color themes for high contrast premium vibes
  const hues = [190, 280, 340, 45, 140];
  const color = `hsl(${hues[Math.floor(Math.random() * hues.length)]}, 95%, 60%)`;

  targets.push({ x, y, radius, color, pulseTimer: Math.random() * 10 });
}

/**
 * Core rendering and coordinate interpolation updates loop.
 */
function gameLoop(timestamp) {
  if (!isConnected) return;
  requestAnimationFrame(gameLoop);

  // 1. Update positions (Interpolation smoothing)
  // crosshair.x += (crosshair.targetX - crosshair.x) * smoothing;
  // crosshair.y += (crosshair.targetY - crosshair.y) * smoothing;

  // Update debug coordinates HUD
  const debugXEl = document.getElementById('debug-x');
  const debugYEl = document.getElementById('debug-y');
  if (debugXEl) debugXEl.textContent = crosshair.x.toFixed(0);
  if (debugYEl) debugYEl.textContent = crosshair.y.toFixed(0);

  // Decay shoot pulse animation scale
  if (crosshair.shootPulse > 0) {
    crosshair.shootPulse -= 0.1;
  }

  // Update particle physics
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.alpha -= p.decay;
    if (p.alpha <= 0) {
      particles.splice(i, 1);
    }
  }

  // 2. Draw canvas frames
  ctx.fillStyle = '#05070f';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw grid background (cyber/motion vibes)
  drawGrid();

  // Draw circular targets with subtle animations
  targets.forEach((target) => {
    target.pulseTimer += 0.05;
    const pulseRadius = target.radius + Math.sin(target.pulseTimer) * 2;

    ctx.save();
    ctx.shadowBlur = 15;
    ctx.shadowColor = target.color;

    // Draw glowing ring
    ctx.beginPath();
    ctx.arc(target.x, target.y, pulseRadius, 0, Math.PI * 2);
    ctx.strokeStyle = target.color;
    ctx.lineWidth = 4;
    ctx.stroke();

    // Draw inner solid center
    ctx.beginPath();
    ctx.arc(target.x, target.y, pulseRadius * 0.4, 0, Math.PI * 2);
    ctx.fillStyle = target.color;
    ctx.fill();

    ctx.restore();
  });

  // Draw particles
  particles.forEach((p) => {
    ctx.save();
    ctx.globalAlpha = p.alpha;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.shadowBlur = 10;
    ctx.shadowColor = p.color;
    ctx.fill();
    ctx.restore();
  });

  // Draw Crosshair
  drawCrosshair();
}

/**
 * Draws a sci-fi cyber grid background.
 */
function drawGrid() {
  const gridSize = 80;
  ctx.strokeStyle = 'rgba(0, 242, 254, 0.04)';
  ctx.lineWidth = 1;

  ctx.beginPath();
  for (let x = 0; x < canvas.width; x += gridSize) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
  }
  for (let y = 0; y < canvas.height; y += gridSize) {
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
  }
  ctx.stroke();
}

/**
 * Draws the visual crosshair cursor.
 */
function drawCrosshair() {
  const x = crosshair.x;
  const y = crosshair.y;
  const pulseScale = 1 + crosshair.shootPulse * 0.4;
  const currentRadius = crosshair.radius * pulseScale;

  ctx.save();
  ctx.shadowBlur = 10;
  ctx.shadowColor = crosshair.shootPulse > 0 ? '#ff007f' : '#00f2fe';
  ctx.strokeStyle = crosshair.shootPulse > 0 ? '#ff007f' : '#00f2fe';
  ctx.lineWidth = 2;

  // Outer segmented ring
  ctx.beginPath();
  ctx.arc(x, y, currentRadius, 0, Math.PI * 1.5);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(x, y, currentRadius, Math.PI * 1.6, Math.PI * 1.9);
  ctx.stroke();

  // Draw central target dot
  ctx.beginPath();
  ctx.arc(x, y, 3, 0, Math.PI * 2);
  ctx.fillStyle = crosshair.shootPulse > 0 ? '#ff007f' : '#00f2fe';
  ctx.fill();

  // Draw indicator cross lines
  const lineLength = 6;
  ctx.beginPath();
  // Top
  ctx.moveTo(x, y - currentRadius - 2);
  ctx.lineTo(x, y - currentRadius - 2 - lineLength);
  // Bottom
  ctx.moveTo(x, y + currentRadius + 2);
  ctx.lineTo(x, y + currentRadius + 2 + lineLength);
  // Left
  ctx.moveTo(x - currentRadius - 2, y);
  ctx.lineTo(x - currentRadius - 2 - lineLength, y);
  // Right
  ctx.moveTo(x + currentRadius + 2, y);
  ctx.lineTo(x + currentRadius + 2 + lineLength, y);
  ctx.stroke();

  ctx.restore();
}

// Initialise Connection
const connection = new GameConnection(handleStatusChange, handleOrientation, handleShoot, recenter);
connection.connect();

// Trigger QR setup
window.addEventListener('DOMContentLoaded', generateLobbyQR);
