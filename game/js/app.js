import { CONNECTION_STATES } from '/shared/constants.js';
import { BACKEND_URL } from '/shared/config.js';
import { GameConnection } from './connection.js';
import { PlayerManager } from './player-manager.js';

// DOM Elements
const lobbyScreen = document.getElementById('lobby-screen');
const gameContainer = document.getElementById('game-container');
const qrImage = document.getElementById('qr-image');
const controllerUrlSpan = document.getElementById('controller-url');
const scoreVal = document.getElementById('score-val');
const sessionIdDisplay = document.getElementById('session-id-display');

// Session generation
const sessionId = Math.random().toString(36).substring(2, 8).toUpperCase();
if (sessionIdDisplay) {
  sessionIdDisplay.textContent = sessionId;
}

// Calibration inputs
const sensSlider = document.getElementById('sens-slider');
const sensVal = document.getElementById('sens-val');
const smoothSlider = document.getElementById('smooth-slider');
const smoothVal = document.getElementById('smooth-val');
const deadzoneSlider = document.getElementById('deadzone-slider');
const deadzoneVal = document.getElementById('deadzone-val');

// Game states
const playerManager = new PlayerManager();
let isConnected = false;
let gameStarted = false;
let canvas, ctx;
let targets = [];
let particles = [];
let towers = [];
let floatingTexts = [];

// 3D Perspective and Levels config
const fov = 350;
const floorY = 2.2;
let currentLevel = 1;
let maxTargets = 2;
let targetFadeTime = 600; // ms
let mapSpeed = 0.04;
let mapZOffset = 0;

const LEVEL_CONFIGS = {
  1: { speed: 0.04, maxTargets: 2, fadeTime: 600 },
  2: { speed: 0.08, maxTargets: 3, fadeTime: 400 },
  3: { speed: 0.12, maxTargets: 4, fadeTime: 250 },
  4: { speed: 0.18, maxTargets: 5, fadeTime: 150 }
};

// Round countdown timer
let timeLeft = 60;
let timerInterval = null;

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
 * Projects 3D coordinates (X, Y, Z) to 2D Screen Space.
 */
function project(x, y, z) {
  if (!canvas) return null;
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  if (z <= 0.1) return null;
  return {
    x: centerX + (x * fov) / z,
    y: centerY + (y * fov) / z,
    scale: fov / z
  };
}

/**
 * Initializes the side towers.
 */
function initTowers() {
  towers = [];
  const numTowers = 12;
  for (let i = 0; i < numTowers; i++) {
    towers.push({
      x: i % 2 === 0 ? -7 - Math.random() * 5 : 7 + Math.random() * 5,
      y: floorY,
      z: (i / numTowers) * 18 + 2.0,
      w: 1.5 + Math.random() * 1.5,
      h: 3.0 + Math.random() * 5.0,
      d: 1.5 + Math.random() * 1.5,
      color: i % 2 === 0 ? 'rgba(0, 242, 254, 0.08)' : 'rgba(255, 0, 127, 0.08)'
    });
  }
}

/**
 * Updates side towers position and draws them.
 */
function updateAndDrawTowers() {
  towers.forEach(t => {
    t.z -= mapSpeed;
    if (t.z < 0.2) {
      t.z = 20;
      t.x = Math.random() > 0.5 ? -7 - Math.random() * 5 : 7 + Math.random() * 5;
      t.w = 1.5 + Math.random() * 1.5;
      t.h = 3.0 + Math.random() * 5.0;
      t.d = 1.5 + Math.random() * 1.5;
    }
    draw3DBox(t.x, t.y, t.z, t.w, t.h, t.d, t.color);
  });
}

/**
 * Draws a 3D box wireframe projected onto the canvas.
 */
function draw3DBox(x, y, z, w, h, d, color) {
  const vertices = [
    { x: x - w/2, y: y,     z: z },
    { x: x + w/2, y: y,     z: z },
    { x: x + w/2, y: y - h, z: z },
    { x: x - w/2, y: y - h, z: z },
    
    { x: x - w/2, y: y,     z: z + d },
    { x: x + w/2, y: y,     z: z + d },
    { x: x + w/2, y: y - h, z: z + d },
    { x: x - w/2, y: y - h, z: z + d }
  ];

  const projected = vertices.map(v => project(v.x, v.y, v.z));

  ctx.strokeStyle = color;
  ctx.lineWidth = 1;

  function drawEdge(i, j) {
    const p1 = projected[i];
    const p2 = projected[j];
    if (p1 && p2) {
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }
  }

  drawEdge(0, 1); drawEdge(1, 2); drawEdge(2, 3); drawEdge(3, 0);
  drawEdge(4, 5); drawEdge(5, 6); drawEdge(6, 7); drawEdge(7, 4);
  drawEdge(0, 4); drawEdge(1, 5); drawEdge(2, 6); drawEdge(3, 7);
}

/**
 * Checks overall score to update level and map speed variables.
 */
function checkLevelProgression() {
  const connectedPlayers = playerManager.getConnectedPlayers();
  const totalScore = connectedPlayers.reduce((sum, p) => sum + p.score, 0);

  let newLevel = 1;
  if (totalScore >= 2200) {
    newLevel = 4;
  } else if (totalScore >= 1200) {
    newLevel = 3;
  } else if (totalScore >= 500) {
    newLevel = 2;
  }

  if (newLevel !== currentLevel) {
    currentLevel = newLevel;
    const config = LEVEL_CONFIGS[currentLevel];
    mapSpeed = config.speed;
    maxTargets = config.maxTargets;
    targetFadeTime = config.fadeTime;

    floatingTexts.push({
      x: canvas.width / 2,
      y: canvas.height / 2 - 100,
      text: `LEVEL ${currentLevel} - SPEED INCREASED!`,
      color: '#ff007f',
      scale: 2.0,
      alpha: 1.5,
      vy: -0.5
    });

    const levelVal = document.getElementById('level-val');
    if (levelVal) {
      levelVal.textContent = currentLevel;
    }
  }
}

/**
 * Renders the QR code for mobile controller access.
 */
async function generateLobbyQR() {
  const controllerUrl = `${BACKEND_URL}/controller/?session=${sessionId}`;
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


function handleStatusChange(state, gameState) {
  const isConnectedVal = state === CONNECTION_STATES.CONNECTED;
  isConnected = isConnectedVal;

  const controllerStatusSpan = document.querySelector('.controller-status .value');
  if (controllerStatusSpan) {
    if (isConnected) {
      controllerStatusSpan.textContent = 'CONNECTED ✅';
      controllerStatusSpan.className = 'value success-glow';
    } else {
      controllerStatusSpan.textContent = 'WAITING ⚪';
      controllerStatusSpan.className = 'value';
    }
  }

  // Update lobby status indicator
  const lobbyStatus = document.getElementById('lobby-status');
  if (lobbyStatus) {
    const activeCount = playerManager.getConnectedPlayers().length;
    if (activeCount > 0) {
      lobbyStatus.textContent = `${activeCount} Player(s) Ready`;
      lobbyStatus.className = 'status-badge success-glow';
    } else {
      lobbyStatus.textContent = 'Waiting for controller...';
      lobbyStatus.className = 'status-badge waiting';
    }
  }

  // If we lost all connections mid-game, return to lobby
  if (!isConnected && gameStarted) {
    returnToLobby();
  }
}

/**
 * Calibrates current sensor readings as the center baseline.
 */
function recenter(arg1) {
  let playerId;
  if (typeof arg1 === 'string') {
    playerId = arg1;
  } else {
    playerId = playerManager.getActivePlayerId() || 'default';
  }

  const player = playerManager.getPlayer(playerId);
  if (player && player.orientation) {
    player.referenceOrientation = { ...player.orientation };
  } else {
    console.warn(`[DESKTOP RECENTER] Recenter requested for player ${playerId}, but orientation data is null.`);
  }
}

/**
 * Handles incoming WebSocket device orientation packets.
 */
function handleOrientation(arg1, arg2, arg3, arg4) {
  let playerId, alpha, beta, gamma;
  if (typeof arg1 === 'string') {
    playerId = arg1;
    alpha = arg2;
    beta = arg3;
    gamma = arg4;
  } else {
    playerId = playerManager.getActivePlayerId() || 'default';
    alpha = arg1;
    beta = arg2;
    gamma = arg3;
  }

  if (!canvas) {
    console.warn("[DESKTOP ORIENTATION] Canvas not initialized yet.");
    return;
  }

  let player = playerManager.getPlayer(playerId);
  if (!player) {
    player = playerManager.addPlayer(playerId);
  }
  player.orientation = { alpha, beta, gamma };
  player.lastSeen = Date.now();

  if (!player.referenceOrientation) {
    player.referenceOrientation = { alpha, beta, gamma };
    player.crosshair.x = canvas.width / 2;
    player.crosshair.y = canvas.height / 2;
    player.crosshair.targetX = player.crosshair.x;
    player.crosshair.targetY = player.crosshair.y;
  }

  // Calculate relative angular difference (alpha = yaw for horizontal, beta = pitch for vertical)
  let diffX = -getAngleDifference(alpha, player.referenceOrientation.alpha);
  let diffY = -getAngleDifference(beta, player.referenceOrientation.beta);

  // Apply player settings
  if (player.invertX) diffX = -diffX;
  if (player.invertY) diffY = -diffY;

  // Apply dead zone
  if (Math.abs(diffX) < deadZone) diffX = 0;
  if (Math.abs(diffY) < deadZone) diffY = 0;

  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;

  // Base multiplier: 1 degree of tilt = 15 pixels at sensitivity 1.0
  const baseScale = 15;
  const playerSens = player.sensitivity !== undefined ? player.sensitivity : 1.0;

  player.crosshair.targetX = centerX + (diffX * baseScale * playerSens * sensitivity);
  player.crosshair.targetY = centerY + (diffY * baseScale * playerSens * sensitivity);

  // Clamp target coordinates within game viewport boundaries
  player.crosshair.targetX = Math.max(player.crosshair.radius, Math.min(canvas.width - player.crosshair.radius, player.crosshair.targetX));
  player.crosshair.targetY = Math.max(player.crosshair.radius, Math.min(canvas.height - player.crosshair.radius, player.crosshair.targetY));
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
function handleShoot(arg1) {
  if (!isConnected || !gameStarted) return;

  let playerId;
  if (typeof arg1 === 'string') {
    playerId = arg1;
  } else {
    playerId = playerManager.getActivePlayerId() || 'default';
  }

  const player = playerManager.getPlayer(playerId);
  if (!player || !player.connected) return;

  const ch = player.crosshair;

  // Apply expansion pulse on crosshair
  ch.shootPulse = 1.0;

  // Spawn visual muzzle particles at crosshair pointer
  spawnParticles(ch.x, ch.y, ch.color, 6);

  // Check overlap collision with active targets in 3D
  for (let i = targets.length - 1; i >= 0; i--) {
    const target = targets[i];
    const proj = project(target.x, target.y, target.z);
    if (!proj) continue;

    const pulseRadius = target.baseRadius * proj.scale + Math.sin(target.pulseTimer) * 1.5;
    const headOffset = target.baseRadius * 1.2 * proj.scale;
    const headX = proj.x;
    const headY = proj.y - headOffset;
    const headRadius = pulseRadius * 0.3;

    // Check hit on head
    const dxHead = ch.x - headX;
    const dyHead = ch.y - headY;
    const distHead = Math.sqrt(dxHead * dxHead + dyHead * dyHead);

    if (distHead < headRadius) {
      // HEADSHOT!
      spawnParticles(headX, headY, '#ff007f', 25);
      
      // Floating text
      floatingTexts.push({
        x: headX,
        y: headY - 15,
        text: 'HEADSHOT +200!',
        color: '#ff007f',
        scale: 1.4,
        alpha: 1.0,
        vy: -1.5
      });

      // Remove target and spawn replacement
      targets.splice(i, 1);
      spawnSingleTarget();

      // Notify server about the hit
      connection.sendPlayerHit(playerId, 'head');
      break;
    }

    // Check hit on body (ellipsoid boundary check)
    const bodyX = proj.x;
    const bodyY = proj.y;
    const bodyRadiusX = pulseRadius * 0.7;
    const bodyRadiusY = pulseRadius * 1.3;

    const normX = (ch.x - bodyX) / bodyRadiusX;
    const normY = (ch.y - bodyY) / bodyRadiusY;
    const insideBody = (normX * normX + normY * normY) <= 1.0;

    if (insideBody) {
      // BODY HIT!
      spawnParticles(bodyX, bodyY, target.color, 15);

      // Floating text
      floatingTexts.push({
        x: bodyX,
        y: bodyY - 15,
        text: 'BODY HIT +100!',
        color: '#00f2fe',
        scale: 1.0,
        alpha: 1.0,
        vy: -1.2
      });

      // Remove target and spawn replacement
      targets.splice(i, 1);
      spawnSingleTarget();

      // Notify server about the hit
      connection.sendPlayerHit(playerId, 'body');
      break;
    }
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

  // Initialize side towers
  initTowers();

  // Clear existing targets and generate initial stack based on current level max
  targets = [];
  for (let i = 0; i < maxTargets; i++) {
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
  if (!canvas) return;

  // Spawns near horizon (Z = 16 to 20)
  const z = 16 + Math.random() * 4;
  // x is relative to road center (-3.5 to 3.5)
  const x = -3.5 + Math.random() * 7.0;
  // y is hovering above grid floor (floorY - 1.2 to floorY - 0.3)
  const y = floorY - (0.3 + Math.random() * 0.9);

  const baseRadius = 0.35; // Size in 3D units

  const hues = [190, 280, 340, 45, 140];
  const color = `hsl(${hues[Math.floor(Math.random() * hues.length)]}, 95%, 60%)`;

  targets.push({
    x,
    y,
    z,
    baseRadius,
    color,
    opacity: 0,
    targetOpacity: 1,
    spawnTime: Date.now(),
    lifespan: 6000,
    pulseTimer: Math.random() * 10,
    lockRingProgress: 1.5
  });
}

/**
 * Core rendering and coordinate interpolation updates loop.
 */
function gameLoop(timestamp) {
  if (!isConnected || !gameStarted) return;
  requestAnimationFrame(gameLoop);

  // 1. Update positions (Interpolation smoothing) for all active players
  playerManager.players.forEach(player => {
    if (!player.connected) return;
    const ch = player.crosshair;
    ch.x += (ch.targetX - ch.x) * smoothing;
    ch.y += (ch.targetY - ch.y) * smoothing;

    // Clamp coordinates within game viewport boundaries
    ch.x = Math.max(ch.radius, Math.min(canvas.width - ch.radius, ch.x));
    ch.y = Math.max(ch.radius, Math.min(canvas.height - ch.radius, ch.y));

    // Decay shoot pulse animation scale
    if (ch.shootPulse > 0) {
      ch.shootPulse -= 0.1;
    }
  });

  // Update target positions & fade-ins
  const now = Date.now();
  for (let i = targets.length - 1; i >= 0; i--) {
    const target = targets[i];
    
    // Animate fade-in (suddenly appear!)
    if (target.opacity < target.targetOpacity) {
      target.opacity += 16.67 / targetFadeTime;
      if (target.opacity > target.targetOpacity) target.opacity = target.targetOpacity;
    }

    // Shrink the locking warning ring
    if (target.lockRingProgress > 0) {
      target.lockRingProgress -= 0.04;
      if (target.lockRingProgress < 0) target.lockRingProgress = 0;
    }

    // Move target slowly towards camera with map speed
    target.z -= mapSpeed;

    // Check if target is out of range or expired
    if (target.z <= 0.5 || (now - target.spawnTime > target.lifespan)) {
      targets.splice(i, 1);
      spawnSingleTarget();
    }
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

  // Draw 3D scrolling grid
  drawGrid();

  // Draw 3D side obstacles/towers
  updateAndDrawTowers();

  // Draw 3D targets with head and body hitboxes
  targets.forEach((target) => {
    const proj = project(target.x, target.y, target.z);
    if (!proj) return;

    target.pulseTimer += 0.05;
    const pulseRadius = target.baseRadius * proj.scale + Math.sin(target.pulseTimer) * 1.5;

    ctx.save();
    ctx.globalAlpha = target.opacity;
    ctx.shadowBlur = 15;
    ctx.shadowColor = target.color;

    const bodyX = proj.x;
    const bodyY = proj.y;
    const bodyRadius = pulseRadius * 0.7;

    const headOffset = target.baseRadius * 1.2 * proj.scale;
    const headX = proj.x;
    const headY = proj.y - headOffset;
    const headRadius = pulseRadius * 0.3;

    // Draw Body capsule
    ctx.beginPath();
    ctx.ellipse(bodyX, bodyY, bodyRadius, bodyRadius * 1.3, 0, 0, Math.PI * 2);
    ctx.strokeStyle = target.color;
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.fillStyle = `rgba(0, 242, 254, 0.08)`;
    ctx.fill();

    // Draw Head
    ctx.beginPath();
    ctx.arc(headX, headY, headRadius, 0, Math.PI * 2);
    ctx.strokeStyle = '#ff007f';
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.fillStyle = '#ff007f';
    ctx.beginPath();
    ctx.arc(headX, headY, headRadius * 0.4, 0, Math.PI * 2);
    ctx.fill();

    // Target corners brackets
    const bracketSize = bodyRadius * 0.6;
    ctx.strokeStyle = target.color;
    ctx.lineWidth = 1.5;
    // Top-Left
    ctx.beginPath();
    ctx.moveTo(bodyX - bodyRadius - 5, bodyY - bodyRadius * 1.3 + bracketSize - 5);
    ctx.lineTo(bodyX - bodyRadius - 5, bodyY - bodyRadius * 1.3 - 5);
    ctx.lineTo(bodyX - bodyRadius + bracketSize - 5, bodyY - bodyRadius * 1.3 - 5);
    ctx.stroke();
    // Bottom-Right
    ctx.beginPath();
    ctx.moveTo(bodyX + bodyRadius + 5, bodyY + bodyRadius * 1.3 - bracketSize + 5);
    ctx.lineTo(bodyX + bodyRadius + 5, bodyY + bodyRadius * 1.3 + 5);
    ctx.lineTo(bodyX + bodyRadius - bracketSize + 5, bodyY + bodyRadius * 1.3 + 5);
    ctx.stroke();

    // Lock-On Ring for sudden appearance
    if (target.lockRingProgress > 0) {
      const ringScale = 1.0 + target.lockRingProgress * 1.5;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.arc(bodyX, bodyY, bodyRadius * ringScale * 1.4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      
      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.font = '9px Orbitron';
      ctx.fillText('TARGET LOCKING...', bodyX - 45, bodyY + bodyRadius * 1.3 + 20);
    }

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

  // Draw Floating Text Indicators
  for (let i = floatingTexts.length - 1; i >= 0; i--) {
    const ft = floatingTexts[i];
    ft.y += ft.vy;
    ft.alpha -= 0.02;
    if (ft.alpha <= 0) {
      floatingTexts.splice(i, 1);
    } else {
      ctx.save();
      ctx.globalAlpha = Math.min(1.0, ft.alpha);
      ctx.fillStyle = ft.color;
      ctx.shadowBlur = 10;
      ctx.shadowColor = ft.color;
      ctx.font = `bold ${Math.round(14 * ft.scale)}px 'Orbitron'`;
      ctx.textAlign = 'center';
      ctx.fillText(ft.text, ft.x, ft.y);
      ctx.restore();
    }
  }

  // Draw Crosshairs for all active players
  playerManager.players.forEach(player => {
    if (player.connected) {
      drawCrosshair(player.crosshair);
    }
  });
}

/**
 * Draws a sci-fi cyber grid background in pseudo 3D perspective scrolling forward.
 */
function drawGrid() {
  if (!canvas || !ctx) return;
  
  // Scroll lateral lines
  mapZOffset -= mapSpeed;
  const spacing = 1.5;
  if (mapZOffset < 0) {
    mapZOffset += spacing;
  }

  ctx.strokeStyle = 'rgba(0, 242, 254, 0.1)';
  ctx.lineWidth = 1;

  const gridWidth = 10;
  const numGridLines = 10;

  // Longitudinal lines (vertical grid paths extending to horizon)
  for (let i = 0; i <= numGridLines; i++) {
    const x = -gridWidth / 2 + (gridWidth / numGridLines) * i;
    const pFar = project(x, floorY, 20);
    const pNear = project(x, floorY, 0.2);
    
    if (pFar && pNear) {
      ctx.beginPath();
      ctx.moveTo(pFar.x, pFar.y);
      ctx.lineTo(pNear.x, pNear.y);
      ctx.stroke();
    }
  }

  // Lateral lines (horizontal scroll lines)
  const maxZ = 20;
  for (let z = mapZOffset; z <= maxZ; z += spacing) {
    const pLeft = project(-gridWidth / 2, floorY, z);
    const pRight = project(gridWidth / 2, floorY, z);

    if (pLeft && pRight) {
      const alpha = Math.max(0, Math.min(1, 1 - (z / maxZ)));
      ctx.strokeStyle = `rgba(0, 242, 254, ${alpha * 0.2})`;
      ctx.beginPath();
      ctx.moveTo(pLeft.x, pLeft.y);
      ctx.lineTo(pRight.x, pRight.y);
      ctx.stroke();
    }
  }
}

/**
 * Draws the visual crosshair cursor.
 */
function drawCrosshair(ch) {
  const x = ch.x;
  const y = ch.y;
  const pulseScale = 1 + ch.shootPulse * 0.4;
  const currentRadius = ch.radius * pulseScale;

  ctx.save();
  ctx.shadowBlur = 15;
  ctx.shadowColor = ch.shootPulse > 0 ? '#ffffff' : ch.color;
  ctx.strokeStyle = ch.shootPulse > 0 ? '#ffffff' : ch.color;
  ctx.lineWidth = 2.5;

  // Outer segmented ring
  ctx.beginPath();
  ctx.arc(x, y, currentRadius, 0, Math.PI * 1.5);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(x, y, currentRadius, Math.PI * 1.6, Math.PI * 1.9);
  ctx.stroke();

  // Draw central target dot
  ctx.beginPath();
  ctx.arc(x, y, 4, 0, Math.PI * 2);
  ctx.fillStyle = ch.shootPulse > 0 ? '#ffffff' : ch.color;
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
const connection = new GameConnection(sessionId, handleStatusChange, handleOrientation, handleShoot, recenter);

// Connection callbacks
connection.onPlayerConnected = (playerData) => {
  playerManager.addPlayer(
    playerData.sessionId, 
    playerData.playerName, 
    playerData.sensitivity, 
    playerData.invertX, 
    playerData.invertY,
    playerData.currentWeapon
  );
  updateLobbyUI();
  updateLeaderboardUI();
};

connection.onPlayerDisconnected = (playerId) => {
  playerManager.removePlayer(playerId);
  updateLobbyUI();
  updateLeaderboardUI();
};

connection.onPlayerSettingsUpdated = (playerId, settings) => {
  playerManager.updateSettings(playerId, settings);
  updateLobbyUI();
  updateLeaderboardUI();
};

connection.onPlayerWeaponChanged = (playerId, weapon) => {
  playerManager.updateWeapon(playerId, weapon);
  updateLeaderboardUI();
};

connection.onPlayerStatsUpdated = (playerId, statsPayload) => {
  playerManager.updateStats(playerId, statsPayload.score, statsPayload.shots, statsPayload.hits);
  updateLeaderboardUI();
  checkLevelProgression();
};

connection.onStartGame = () => {
  startGame();
};

// Lobby UI Sync
function updateLobbyUI() {
  const slots = document.querySelectorAll('.player-slot');
  const startBtn = document.getElementById('start-game-btn');
  const connectedPlayers = playerManager.getConnectedPlayers();

  // Update status slots (up to 3)
  for (let i = 0; i < 3; i++) {
    const slot = slots[i];
    if (!slot) continue;

    // Find the player representing this slot index
    const player = connectedPlayers.find(p => p.playerIndex === i);

    if (player) {
      slot.classList.add('active');
      slot.innerHTML = `<span class="status-dot" style="color: ${player.crosshair.color};">●</span> <span class="player-name">${player.playerName}</span>`;
    } else {
      slot.classList.remove('active');
      slot.innerHTML = `<span class="status-dot empty">⚪</span> <span class="player-name empty">Waiting...</span>`;
    }
  }

  // Toggle Start button
  if (startBtn) {
    startBtn.disabled = connectedPlayers.length === 0;
  }
}

// Live Leaderboard updates
function updateLeaderboardUI() {
  const listContainer = document.getElementById('leaderboard-list');
  if (!listContainer) return;

  const connectedPlayers = playerManager.getConnectedPlayers();
  // Sort descending by score
  connectedPlayers.sort((a, b) => b.score - a.score);

  // Update DOM elements inside container
  listContainer.innerHTML = '';
  // Set explicit height based on number of players
  listContainer.style.height = `${connectedPlayers.length * 52}px`;

  connectedPlayers.forEach((player, index) => {
    const entry = document.createElement('div');
    entry.className = 'leaderboard-entry';
    entry.style.transform = `translateY(${index * 52}px)`;

    const weaponName = (player.currentWeapon || 'pistol').toUpperCase();
    entry.innerHTML = `
      <div class="leaderboard-entry-left">
        <span class="player-dot" style="color: ${player.crosshair.color}; background: ${player.crosshair.color};"></span>
        <span class="leaderboard-name">${player.playerName}</span>
        <span class="hud-weapon" style="font-size: 10px; font-weight: 700; color: rgba(255,255,255,0.4); margin-left: 8px; letter-spacing: 0.5px;">[${weaponName}]</span>
      </div>
      <div class="score-dots"></div>
      <span class="score-val">${player.score}</span>
    `;

    listContainer.appendChild(entry);
  });

  // Also update overall HUD score (display total sum of scores)
  const totalScore = connectedPlayers.reduce((sum, p) => sum + p.score, 0);
  if (scoreVal) {
    scoreVal.textContent = String(totalScore).padStart(3, '0');
  }
}

// Game transitions
function startGame() {
  gameStarted = true;
  timeLeft = 60;

  // Reset level states
  currentLevel = 1;
  mapSpeed = LEVEL_CONFIGS[1].speed;
  maxTargets = LEVEL_CONFIGS[1].maxTargets;
  targetFadeTime = LEVEL_CONFIGS[1].fadeTime;
  floatingTexts = [];
  
  const levelVal = document.getElementById('level-val');
  if (levelVal) {
    levelVal.textContent = currentLevel;
  }

  // UI state transition
  lobbyScreen.classList.add('hidden');
  document.getElementById('end-screen').classList.add('hidden');
  gameContainer.classList.remove('hidden');
  document.getElementById('leaderboard-panel').classList.remove('hidden');

  // Reset HUD Timer styles
  const timerVal = document.getElementById('timer-val');
  if (timerVal) {
    timerVal.textContent = timeLeft;
    timerVal.parentElement.classList.remove('warning');
  }

  // Setup canvas
  initCanvas();
  updateLeaderboardUI();

  // Notify server and all controllers that the game has started
  connection.sendStartGame();

  // Reset/Start timer loop
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    timeLeft--;
    if (timerVal) {
      timerVal.textContent = timeLeft;
      if (timeLeft <= 10) {
        timerVal.parentElement.classList.add('warning');
      }
    }

    if (timeLeft <= 0) {
      clearInterval(timerInterval);
      endGame();
    }
  }, 1000);
}

function endGame() {
  gameStarted = false;
  if (timerInterval) clearInterval(timerInterval);

  const connectedPlayers = playerManager.getConnectedPlayers();
  connectedPlayers.sort((a, b) => b.score - a.score);

  const endScreen = document.getElementById('end-screen');
  const winnerName = document.getElementById('winner-name');
  const winnerScore = document.getElementById('winner-score');
  const winnerAccuracy = document.getElementById('winner-accuracy');
  const winnerHits = document.getElementById('winner-hits');
  const winnerShots = document.getElementById('winner-shots');

  const secondRow = document.getElementById('runner-second');
  const thirdRow = document.getElementById('runner-third');

  // Populate winner stats (1st place)
  if (connectedPlayers.length > 0) {
    const winner = connectedPlayers[0];
    winnerName.textContent = winner.playerName.toUpperCase();
    winnerScore.textContent = winner.score;
    winnerHits.textContent = winner.hits;
    winnerShots.textContent = winner.shots;
    
    const accuracy = winner.shots > 0 ? Math.round((winner.hits / winner.shots) * 100) : 0;
    winnerAccuracy.textContent = `${accuracy}%`;
  } else {
    winnerName.textContent = 'NO PLAYERS';
    winnerScore.textContent = '0';
    winnerAccuracy.textContent = '0%';
    winnerHits.textContent = '0';
    winnerShots.textContent = '0';
  }

  // Populate 2nd place
  if (connectedPlayers.length >= 2) {
    secondRow.style.display = 'flex';
    document.getElementById('runner-second-dot').style.background = connectedPlayers[1].crosshair.color;
    document.getElementById('runner-second-name').textContent = connectedPlayers[1].playerName;
    document.getElementById('runner-second-score').textContent = connectedPlayers[1].score;
  } else {
    secondRow.style.display = 'none';
  }

  // Populate 3rd place
  if (connectedPlayers.length >= 3) {
    thirdRow.style.display = 'flex';
    document.getElementById('runner-third-dot').style.background = connectedPlayers[2].crosshair.color;
    document.getElementById('runner-third-name').textContent = connectedPlayers[2].playerName;
    document.getElementById('runner-third-score').textContent = connectedPlayers[2].score;
  } else {
    thirdRow.style.display = 'none';
  }

  // Show end screen
  if (endScreen) {
    endScreen.classList.remove('hidden');
  }
}

function playAgain() {
  connection.sendResetStats();
  playerManager.resetAllPlayerStats();
  startGame();
}

function returnToLobby() {
  gameStarted = false;
  if (timerInterval) clearInterval(timerInterval);
  connection.sendReturnToLobby();
  playerManager.resetAllPlayerStats();

  // Transition UI
  document.getElementById('end-screen').classList.add('hidden');
  gameContainer.classList.add('hidden');
  document.getElementById('leaderboard-panel').classList.add('hidden');
  lobbyScreen.classList.remove('hidden');
  
  updateLobbyUI();
}

// Bind button actions

const playAgainBtn = document.getElementById('play-again-btn');
if (playAgainBtn) {
  playAgainBtn.addEventListener('click', playAgain);
}

const returnLobbyBtn = document.getElementById('return-lobby-btn');
if (returnLobbyBtn) {
  returnLobbyBtn.addEventListener('click', returnToLobby);
}

connection.connect();

// Trigger QR setup
window.addEventListener('DOMContentLoaded', generateLobbyQR);
