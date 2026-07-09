import { CONNECTION_STATES, WEAPONS } from '/shared/constants.js';
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
let laserTrails = [];
let muzzleFlashes = [];

// 3D Perspective and Levels config
const fov = 350;
const floorY = 2.2;
let currentLevel = 1;
let maxTargets = 2;
let targetFadeTime = 600; // ms
let mapSpeed = 0.04;
let mapZOffset = 0;

// Canyon Track Curvature
let trackCurve = 0;
let targetCurve = 0;
let curvePhase = 0;

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

// Web Audio Context & Synth sounds (Pews, metallic hits, bells)
let audioCtx = null;

function initAudio() {
  if (audioCtx) return;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (AudioContextClass) {
    audioCtx = new AudioContextClass();
  }
}

function synthSound(freqs, duration, type = 'sine', volume = 0.1, sweep = true) {
  initAudio();
  if (!audioCtx) return;
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  
  osc.type = type;
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  
  const now = audioCtx.currentTime;
  gain.gain.setValueAtTime(volume, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  if (Array.isArray(freqs)) {
    if (sweep) {
      osc.frequency.setValueAtTime(freqs[0], now);
      osc.frequency.exponentialRampToValueAtTime(freqs[1], now + duration);
    } else {
      const noteDuration = duration / freqs.length;
      freqs.forEach((freq, idx) => {
        osc.frequency.setValueAtTime(freq, now + idx * noteDuration);
      });
    }
  } else {
    osc.frequency.setValueAtTime(freqs, now);
  }

  osc.start(now);
  osc.stop(now + duration);
}

function playNoiseExplosion(duration, volume = 0.2, highPass = false) {
  initAudio();
  if (!audioCtx) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();

  const bufferSize = audioCtx.sampleRate * duration;
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }

  const noise = audioCtx.createBufferSource();
  noise.buffer = buffer;

  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(volume, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);

  const filter = audioCtx.createBiquadFilter();
  filter.type = highPass ? 'highpass' : 'lowpass';
  filter.frequency.value = highPass ? 1200 : 700;
  
  noise.connect(filter);
  filter.connect(gain);
  gain.connect(audioCtx.destination);
  
  noise.start();
}

function playShootSound(weaponType) {
  if (weaponType === 'laser') {
    synthSound([1200, 600], 0.12, 'square', 0.05);
  } else if (weaponType === 'railgun') {
    synthSound([180, 45], 0.5, 'sawtooth', 0.25);
    playNoiseExplosion(0.4, 0.2);
  } else { // plasma
    synthSound([750, 150], 0.25, 'triangle', 0.15);
  }
}

function playHitSound(hitType) {
  if (hitType === 'head') {
    synthSound([2000, 2200], 0.2, 'sine', 0.18, false); // clear bell
  } else {
    synthSound([240, 100], 0.15, 'triangle', 0.12); // dull impact
  }
}

function playLevelUpSound() {
  synthSound([523.25, 659.25, 783.99, 1046.50], 0.6, 'sine', 0.18, false); // C5-E5-G5-C6
}

function playPowerAttackSound() {
  synthSound([120, 30], 0.9, 'sawtooth', 0.4);
  playNoiseExplosion(0.9, 0.4);
}

function playChargeSound(progress) {
  synthSound([220 + progress * 330, 230 + progress * 330], 0.05, 'sine', 0.05 * progress);
}

/**
 * Projects 3D coordinates (X, Y, Z) to 2D Screen Space with track curving.
 */
function project(x, y, z) {
  if (!canvas) return null;
  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  if (z <= 0.1) return null;

  // Apply bending curve on track relative to distance Z (quadratic bend)
  const curveOffset = trackCurve * (z * z) * 0.04;

  return {
    x: centerX + ((x + curveOffset) * fov) / z,
    y: centerY + (y * fov) / z,
    scale: fov / z
  };
}

/**
 * Draws a walk-animated wireframe 3D Robot target with eye visor and health bar.
 */
function drawWalkingRobot(target) {
  const proj = project(target.x, target.y, target.z);
  if (!proj) return;

  target.pulseTimer += 0.05;
  target.walkPhase = (target.walkPhase || 0) + 0.08;
  
  const walkSwing = Math.sin(target.walkPhase) * 0.35;
  const armSwing = Math.cos(target.walkPhase) * 0.4;

  ctx.save();
  ctx.globalAlpha = target.opacity;
  ctx.shadowBlur = 10;
  
  // Flashing red when damaged, otherwise target color
  const color = target.flashTime > Date.now() ? '#ff3333' : target.color;
  ctx.shadowColor = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;

  // Draw 3D joints
  // 1. Torso Box
  const tTopL = project(target.x - 0.2, target.y - 0.7, target.z);
  const tTopR = project(target.x + 0.2, target.y - 0.7, target.z);
  const tBotL = project(target.x - 0.15, target.y - 0.2, target.z);
  const tBotR = project(target.x + 0.15, target.y - 0.2, target.z);

  if (tTopL && tTopR && tBotL && tBotR) {
    ctx.beginPath();
    ctx.moveTo(tTopL.x, tTopL.y);
    ctx.lineTo(tTopR.x, tTopR.y);
    ctx.lineTo(tBotR.x, tBotR.y);
    ctx.lineTo(tBotL.x, tBotL.y);
    ctx.closePath();
    ctx.stroke();

    // Fill Torso semi-transparent
    ctx.fillStyle = 'rgba(0, 242, 254, 0.04)';
    ctx.fill();
  }

  // 2. Head (Cube or circle)
  const hCenter = project(target.x, target.y - 0.95, target.z);
  if (hCenter) {
    const headRad = 0.12 * hCenter.scale;
    
    // Draw outer head circle
    ctx.beginPath();
    ctx.arc(hCenter.x, hCenter.y, headRad, 0, Math.PI * 2);
    ctx.stroke();

    // Draw glowing visor eye line
    ctx.strokeStyle = '#ff007f';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(hCenter.x - headRad * 0.6, hCenter.y);
    ctx.lineTo(hCenter.x + headRad * 0.6, hCenter.y);
    ctx.stroke();

    ctx.strokeStyle = color; // restore color
    ctx.lineWidth = 2;
  }

  // 3. Left Arm (Swings)
  const shoulderL = project(target.x - 0.22, target.y - 0.65, target.z);
  const handL = project(target.x - 0.35, target.y - 0.45 + armSwing * 0.1, target.z - armSwing * 0.5);
  if (shoulderL && handL) {
    ctx.beginPath();
    ctx.moveTo(shoulderL.x, shoulderL.y);
    ctx.lineTo(handL.x, handL.y);
    ctx.stroke();
  }

  // 4. Right Arm (Swings opposite)
  const shoulderR = project(target.x + 0.22, target.y - 0.65, target.z);
  const handR = project(target.x + 0.35, target.y - 0.45 - armSwing * 0.1, target.z + armSwing * 0.5);
  if (shoulderR && handR) {
    ctx.beginPath();
    ctx.moveTo(shoulderR.x, shoulderR.y);
    ctx.lineTo(handR.x, handR.y);
    ctx.stroke();
  }

  // 5. Left Leg (Swings back/forth)
  const footL = project(target.x - 0.14 + walkSwing * 0.1, target.y + 0.1, target.z + walkSwing * 0.6);
  if (tBotL && footL) {
    ctx.beginPath();
    ctx.moveTo(tBotL.x, tBotL.y);
    ctx.lineTo(footL.x, footL.y);
    ctx.stroke();
  }

  // 6. Right Leg (Swings opposite)
  const footR = project(target.x + 0.14 - walkSwing * 0.1, target.y + 0.1, target.z - walkSwing * 0.6);
  if (tBotR && footR) {
    ctx.beginPath();
    ctx.moveTo(tBotR.x, tBotR.y);
    ctx.lineTo(footR.x, footR.y);
    ctx.stroke();
  }

  // 7. Draw floating Health Bar above head
  const hBar = project(target.x, target.y - 1.25, target.z);
  if (hBar) {
    const barWidth = 35;
    const barHeight = 4;
    const pct = target.health / 100;
    
    // Background bar (red)
    ctx.fillStyle = 'rgba(255, 0, 0, 0.4)';
    ctx.fillRect(hBar.x - barWidth / 2, hBar.y, barWidth, barHeight);
    
    // Foreground bar (green / orange / red depending on pct)
    ctx.fillStyle = pct > 0.5 ? '#00ff66' : (pct > 0.25 ? '#ff9f43' : '#ff3333');
    ctx.fillRect(hBar.x - barWidth / 2, hBar.y, barWidth * pct, barHeight);

    // Border
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(hBar.x - barWidth / 2, hBar.y, barWidth, barHeight);
  }

  ctx.restore();
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

    // Play level advancement sound synthesizer
    playLevelUpSound();

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
function handleShoot(arg1, isCharged = false) {
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

  // Retrieve current weapon configuration
  const activeWeaponKey = player.currentWeapon || 'plasma';
  const weapon = WEAPONS[activeWeaponKey] || WEAPONS.plasma;

  if (isCharged) {
    // 1. Quantum Mega-Beam Power Attack
    playPowerAttackSound();
    
    // Draw screen-wide flashing mega beam trail
    laserTrails.push({
      startX1: 0,
      startY1: canvas.height,
      startX2: canvas.width,
      startY2: canvas.height,
      endX: ch.x,
      endY: ch.y,
      color: '#ffffff',
      alpha: 2.2,
      width: 16
    });

    // Hexagonal blast rings
    for (let r = 20; r <= 80; r += 20) {
      muzzleFlashes.push({
        x: ch.x,
        y: ch.y,
        radius: r,
        maxRadius: 120,
        color: '#00ff66',
        alpha: 1.0
      });
    }

    // Eliminate targets close to the aim point (within a 160px blast radius)
    const blastRadius = 160;
    for (let i = targets.length - 1; i >= 0; i--) {
      const target = targets[i];
      const proj = project(target.x, target.y, target.z);
      if (proj) {
        const dx = proj.x - ch.x;
        const dy = proj.y - ch.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < blastRadius) {
          spawnParticles(proj.x, proj.y, '#00ff66', 30);
          
          floatingTexts.push({
            x: proj.x,
            y: proj.y - 30,
            text: 'MEGA-BLAST SHATTER! +100',
            color: '#00ff66',
            scale: 1.3,
            alpha: 1.0,
            vy: -1.2
          });

          // Record a body hit kill on the server
          connection.sendPlayerHit(playerId, 'body');

          targets.splice(i, 1);
          spawnSingleTarget();
        }
      }
    }
    return;
  }

  // 2. Normal Futuristic Laser Fire
  playShootSound(activeWeaponKey);

  // Add turret laser beams (left & right corners to crosshair)
  laserTrails.push({
    startX1: 0,
    startY1: canvas.height,
    startX2: canvas.width,
    startY2: canvas.height,
    endX: ch.x,
    endY: ch.y,
    color: weapon.color,
    alpha: 1.0,
    width: 3.5
  });

  // Muzzle hexagon flash
  muzzleFlashes.push({
    x: ch.x,
    y: ch.y,
    radius: 12,
    maxRadius: 40,
    color: weapon.color,
    alpha: 1.0
  });

  // Spawn visual muzzle sparks
  spawnParticles(ch.x, ch.y, weapon.color, 8);

  // Check collision with robots
  for (let i = targets.length - 1; i >= 0; i--) {
    const target = targets[i];
    const proj = project(target.x, target.y, target.z);
    if (!proj) continue;

    // Head dimensions
    const hCenter = project(target.x, target.y - 0.95, target.z);
    if (!hCenter) continue;
    const headRad = 0.12 * hCenter.scale;

    // Check hit on head (1 shot kill!) with a minimum hit tolerance of 22 pixels
    const dxHead = ch.x - hCenter.x;
    const dyHead = ch.y - hCenter.y;
    const distHead = Math.sqrt(dxHead * dxHead + dyHead * dyHead);
    const headHitbox = Math.max(headRad, 22);

    if (distHead < headHitbox) {
      // Instant Headshot Kill!
      playHitSound('head');
      spawnParticles(hCenter.x, hCenter.y, '#ff007f', 28);
      
      floatingTexts.push({
        x: hCenter.x,
        y: hCenter.y - 25,
        text: 'CRITICAL HEADSHOT! +200',
        color: '#ff007f',
        scale: 1.4,
        alpha: 1.0,
        vy: -1.5
      });

      targets.splice(i, 1);
      spawnSingleTarget();

      connection.sendPlayerHit(playerId, 'head');
      break;
    }

    // Body dimensions with minimum hit tolerance (at least 25x35 pixels box check)
    const bodyX = proj.x;
    const bodyY = proj.y - 0.45 * proj.scale;
    const bodyRadiusX = Math.max(0.25 * proj.scale, 25);
    const bodyRadiusY = Math.max(0.35 * proj.scale, 35);

    const normX = (ch.x - bodyX) / bodyRadiusX;
    const normY = (ch.y - bodyY) / bodyRadiusY;
    const insideBody = (normX * normX + normY * normY) <= 1.0;

    if (insideBody) {
      // Body Hit: 50% damage
      target.health -= 50;
      target.flashTime = Date.now() + 150; // flash red helper

      if (target.health <= 0) {
        // Destroyed!
        playHitSound('body');
        spawnParticles(bodyX, bodyY, target.color, 20);

        floatingTexts.push({
          x: bodyX,
          y: bodyY - 25,
          text: 'ROBOT DESTROYED! +100',
          color: '#00f2fe',
          scale: 1.1,
          alpha: 1.0,
          vy: -1.2
        });

        targets.splice(i, 1);
        spawnSingleTarget();

        connection.sendPlayerHit(playerId, 'body');
      } else {
        // Shield damaged
        playHitSound('body');
        spawnParticles(bodyX, bodyY, 'rgba(255,255,255,0.8)', 8);

        floatingTexts.push({
          x: bodyX,
          y: bodyY - 25,
          text: 'SHIELD DAMAGED! 50%',
          color: '#ff9f43',
          scale: 0.9,
          alpha: 1.0,
          vy: -0.9
        });
      }
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
    lockRingProgress: 1.5,
    health: 100,
    walkPhase: Math.random() * Math.PI * 2,
    flashTime: 0
  });
}

/**
 * Core rendering and coordinate interpolation updates loop.
 */
function gameLoop(timestamp) {
  if (!isConnected || !gameStarted) return;
  requestAnimationFrame(gameLoop);

  // 1. Curve Canyon Track Map bending transitions
  curvePhase += 0.006;
  targetCurve = Math.sin(curvePhase) * Math.cos(curvePhase * 0.6) * 1.6;
  trackCurve += (targetCurve - trackCurve) * 0.015;

  // 2. Update positions (Interpolation smoothing) for all active players
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

  // Update and fade visual laser trails
  for (let i = laserTrails.length - 1; i >= 0; i--) {
    const trail = laserTrails[i];
    trail.alpha -= 0.12;
    if (trail.alpha <= 0) {
      laserTrails.splice(i, 1);
    }
  }

  // Update and fade muzzle flashes
  for (let i = muzzleFlashes.length - 1; i >= 0; i--) {
    const mf = muzzleFlashes[i];
    mf.radius += 3.5;
    mf.alpha -= 0.1;
    if (mf.alpha <= 0) {
      muzzleFlashes.splice(i, 1);
    }
  }

  // 3. Draw canvas frames
  ctx.fillStyle = '#05070f';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw 3D scrolling grid
  drawGrid();

  // Draw 3D side obstacles/towers
  updateAndDrawTowers();

  // Draw 3D walk-animated robot targets
  targets.forEach((target) => {
    drawWalkingRobot(target);
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

  // Draw muzzle flash hexagons
  muzzleFlashes.forEach((mf) => {
    ctx.save();
    ctx.globalAlpha = mf.alpha;
    ctx.strokeStyle = mf.color;
    ctx.lineWidth = 2.5;
    ctx.shadowBlur = 12;
    ctx.shadowColor = mf.color;

    ctx.beginPath();
    for (let j = 0; j < 6; j++) {
      const angle = (j * Math.PI) / 3;
      const hx = mf.x + Math.cos(angle) * mf.radius;
      const hy = mf.y + Math.sin(angle) * mf.radius;
      if (j === 0) ctx.moveTo(hx, hy);
      else ctx.lineTo(hx, hy);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  });

  // Draw laser beam trails
  laserTrails.forEach((trail) => {
    ctx.save();
    ctx.globalAlpha = Math.min(1.0, trail.alpha);
    ctx.strokeStyle = trail.color;
    ctx.lineWidth = trail.width * Math.min(1.0, trail.alpha);
    ctx.shadowBlur = 18;
    ctx.shadowColor = trail.color;

    ctx.beginPath();
    ctx.moveTo(trail.startX1, trail.startY1);
    ctx.lineTo(trail.endX, trail.endY);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(trail.startX2, trail.startY2);
    ctx.lineTo(trail.endX, trail.endY);
    ctx.stroke();

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

  // Draw Crosshairs and charging indicators for all active players
  playerManager.players.forEach(player => {
    if (player.connected) {
      const ch = player.crosshair;
      drawCrosshair(ch);

      // Draw charging ring progress overlay
      if (player.chargeProgress > 0) {
        ctx.save();
        ctx.strokeStyle = '#00ff66';
        ctx.lineWidth = 3;
        ctx.shadowBlur = 10;
        ctx.shadowColor = '#00ff66';
        ctx.beginPath();
        ctx.arc(ch.x, ch.y, ch.radius + 8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * player.chargeProgress);
        ctx.stroke();
        ctx.restore();
      }
    }
  });
}

/**
 * Draws a sci-fi cyber grid background in pseudo 3D perspective scrolling forward.
 */
function drawGrid() {
  if (!canvas || !ctx) return;
  
  mapZOffset -= mapSpeed;
  const spacing = 1.5;
  if (mapZOffset < 0) {
    mapZOffset += spacing;
  }

  ctx.strokeStyle = 'rgba(0, 242, 254, 0.12)';
  ctx.lineWidth = 1.2;

  const gridWidth = 10;
  const numGridLines = 10;
  const maxZ = 20;

  // 1. Draw stepped longitudinal lines to reflect track curvature
  for (let i = 0; i <= numGridLines; i++) {
    const x = -gridWidth / 2 + (gridWidth / numGridLines) * i;
    
    ctx.beginPath();
    let first = true;
    for (let z = 20; z >= 0.2; z -= 1.0) {
      const proj = project(x, floorY, z);
      if (proj) {
        if (first) {
          ctx.moveTo(proj.x, proj.y);
          first = false;
        } else {
          ctx.lineTo(proj.x, proj.y);
        }
      }
    }
    ctx.stroke();
  }

  // 2. Draw lateral lines
  for (let z = mapZOffset; z <= maxZ; z += spacing) {
    const pLeft = project(-gridWidth / 2, floorY, z);
    const pRight = project(gridWidth / 2, floorY, z);

    if (pLeft && pRight) {
      const alpha = Math.max(0, Math.min(1, 1 - (z / maxZ)));
      ctx.strokeStyle = `rgba(0, 242, 254, ${alpha * 0.22})`;
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

connection.onChargeUpdate = (playerId, charge) => {
  const player = playerManager.getPlayer(playerId);
  if (player) {
    player.chargeProgress = charge;
    if (charge > 0) {
      playChargeSound(charge);
    }
  }
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

    const weaponName = (player.currentWeapon || 'plasma').toUpperCase();
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
