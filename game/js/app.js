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

// Map selection & Map 2 (Sniper Apartment) states
let activeMap = 1;
let map2Stage = 'intro'; // 'intro', 'play'
let map2Windows = [];
let lastMap2SpawnTime = 0;

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
  const bobY = Math.abs(Math.sin(target.walkPhase * 2)) * 0.04;

  ctx.save();
  ctx.globalAlpha = target.opacity;
  ctx.shadowBlur = 12;
  
  // Flashing red when damaged, otherwise target color
  const color = target.flashTime > Date.now() ? '#ff3333' : target.color;
  ctx.shadowColor = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.2;

  // 1. Draw Torso Box with bobbing height
  const tTopL = project(target.x - 0.22, target.y - 0.7 + bobY, target.z);
  const tTopR = project(target.x + 0.22, target.y - 0.7 + bobY, target.z);
  const tBotL = project(target.x - 0.16, target.y - 0.22 + bobY, target.z);
  const tBotR = project(target.x + 0.16, target.y - 0.22 + bobY, target.z);

  if (tTopL && tTopR && tBotL && tBotR) {
    ctx.beginPath();
    ctx.moveTo(tTopL.x, tTopL.y);
    ctx.lineTo(tTopR.x, tTopR.y);
    ctx.lineTo(tBotR.x, tBotR.y);
    ctx.lineTo(tBotL.x, tBotL.y);
    ctx.closePath();
    ctx.stroke();

    ctx.fillStyle = 'rgba(0, 242, 254, 0.04)';
    ctx.fill();

    // 2. Shoulder Pads (Pauldrons)
    const pL1 = project(target.x - 0.26, target.y - 0.74 + bobY, target.z);
    const pL2 = project(target.x - 0.18, target.y - 0.66 + bobY, target.z);
    if (pL1 && pL2) {
      ctx.strokeRect(pL1.x, pL1.y, pL2.x - pL1.x, pL2.y - pL1.y);
    }
    const pR1 = project(target.x + 0.18, target.y - 0.74 + bobY, target.z);
    const pR2 = project(target.x + 0.26, target.y - 0.66 + bobY, target.z);
    if (pR1 && pR2) {
      ctx.strokeRect(pR1.x, pR1.y, pR2.x - pR1.x, pR2.y - pR1.y);
    }

    // 3. Glowing Chest Reactor Core
    const reactor = project(target.x, target.y - 0.46 + bobY, target.z);
    if (reactor) {
      ctx.beginPath();
      ctx.arc(reactor.x, reactor.y, 0.05 * reactor.scale, 0, Math.PI * 2);
      ctx.fillStyle = '#00f2fe';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.strokeStyle = color; // restore color
      ctx.lineWidth = 2.2;
    }
  }

  // 4. Head & Helmet Details (Cube or circle)
  const hCenter = project(target.x, target.y - 0.95 + bobY, target.z);
  if (hCenter) {
    const headRad = 0.12 * hCenter.scale;
    
    // Helmet Antenna
    const antTop = project(target.x, target.y - 1.15 + bobY, target.z);
    if (antTop) {
      ctx.beginPath();
      ctx.moveTo(hCenter.x, hCenter.y - headRad);
      ctx.lineTo(antTop.x, antTop.y);
      ctx.stroke();

      // Antenna tip dot
      ctx.beginPath();
      ctx.arc(antTop.x, antTop.y, 2, 0, Math.PI * 2);
      ctx.fillStyle = '#ff007f';
      ctx.fill();
    }

    // Side helmet vents
    const ventL = project(target.x - 0.16, target.y - 0.95 + bobY, target.z);
    const ventR = project(target.x + 0.16, target.y - 0.95 + bobY, target.z);
    if (ventL && ventR) {
      ctx.beginPath();
      ctx.moveTo(ventL.x, ventL.y);
      ctx.lineTo(hCenter.x - headRad, hCenter.y);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(ventR.x, ventR.y);
      ctx.lineTo(hCenter.x + headRad, hCenter.y);
      ctx.stroke();
    }

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
    ctx.lineWidth = 2.2;
  }

  // 5. Left Arm (Segmented Hinging joints: Shoulder -> Elbow -> Hand)
  const shoulderL = project(target.x - 0.22, target.y - 0.65 + bobY, target.z);
  const handL = project(target.x - 0.35, target.y - 0.45 + armSwing * 0.08, target.z - armSwing * 0.5);
  // Calculate naturally bent elbow position
  const elbowL = project(
    (target.x - 0.22 + target.x - 0.35) / 2 - 0.04,
    (target.y - 0.65 + bobY + target.y - 0.45) / 2 + 0.05,
    (target.z + target.z - armSwing * 0.5) / 2 - 0.08 * Math.sin(target.walkPhase)
  );

  if (shoulderL && elbowL && handL) {
    ctx.beginPath();
    ctx.moveTo(shoulderL.x, shoulderL.y);
    ctx.lineTo(elbowL.x, elbowL.y);
    ctx.lineTo(handL.x, handL.y);
    ctx.stroke();

    // Draw joint nodes
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(elbowL.x, elbowL.y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // 6. Right Arm (Segmented: Shoulder -> Elbow -> Hand)
  const shoulderR = project(target.x + 0.22, target.y - 0.65 + bobY, target.z);
  const handR = project(target.x + 0.35, target.y - 0.45 - armSwing * 0.08, target.z + armSwing * 0.5);
  const elbowR = project(
    (target.x + 0.22 + target.x + 0.35) / 2 + 0.04,
    (target.y - 0.65 + bobY + target.y - 0.45) / 2 + 0.05,
    (target.z + target.z + armSwing * 0.5) / 2 + 0.08 * Math.sin(target.walkPhase)
  );

  if (shoulderR && elbowR && handR) {
    ctx.beginPath();
    ctx.moveTo(shoulderR.x, shoulderR.y);
    ctx.lineTo(elbowR.x, elbowR.y);
    ctx.lineTo(handR.x, handR.y);
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(elbowR.x, elbowR.y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // 7. Left Leg (Segmented Hinging joints: Hip -> Knee -> Foot)
  const footL = project(target.x - 0.14 + walkSwing * 0.1, target.y + 0.12, target.z + walkSwing * 0.6);
  const kneeL = project(
    (target.x - 0.16 + (target.x - 0.14 + walkSwing * 0.1)) / 2 - 0.04,
    (target.y - 0.22 + bobY + target.y + 0.12) / 2 + 0.04,
    (target.z + (target.z + walkSwing * 0.6)) / 2 + 0.08 * Math.cos(target.walkPhase)
  );

  if (tBotL && kneeL && footL) {
    ctx.beginPath();
    ctx.moveTo(tBotL.x, tBotL.y);
    ctx.lineTo(kneeL.x, kneeL.y);
    ctx.lineTo(footL.x, footL.y);
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(kneeL.x, kneeL.y, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Thruster exhaust spark
    if (Math.random() < 0.18) {
      particles.push({
        x: footL.x + (Math.random() - 0.5) * 6,
        y: footL.y + 2,
        vx: (Math.random() - 0.5) * 0.8,
        vy: 1.0 + Math.random() * 1.5,
        radius: 1.0 + Math.random() * 1.5,
        color: 'rgba(0, 242, 254, 0.45)',
        alpha: 0.8,
        decay: 0.03
      });
    }
  }

  // 8. Right Leg (Segmented: Hip -> Knee -> Foot)
  const footR = project(target.x + 0.14 - walkSwing * 0.1, target.y + 0.12, target.z - walkSwing * 0.6);
  const kneeR = project(
    (target.x + 0.16 + (target.x + 0.14 - walkSwing * 0.1)) / 2 + 0.04,
    (target.y - 0.22 + bobY + target.y + 0.12) / 2 + 0.04,
    (target.z + (target.z - walkSwing * 0.6)) / 2 - 0.08 * Math.cos(target.walkPhase)
  );

  if (tBotR && kneeR && footR) {
    ctx.beginPath();
    ctx.moveTo(tBotR.x, tBotR.y);
    ctx.lineTo(kneeR.x, kneeR.y);
    ctx.lineTo(footR.x, footR.y);
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(kneeR.x, kneeR.y, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Thruster exhaust spark
    if (Math.random() < 0.18) {
      particles.push({
        x: footR.x + (Math.random() - 0.5) * 6,
        y: footR.y + 2,
        vx: (Math.random() - 0.5) * 0.8,
        vy: 1.0 + Math.random() * 1.5,
        radius: 1.0 + Math.random() * 1.5,
        color: 'rgba(0, 242, 254, 0.45)',
        alpha: 0.8,
        decay: 0.03
      });
    }
  }

  // 9. Draw floating Health Bar above head
  const hBar = project(target.x, target.y - 1.25 + bobY, target.z);
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
 * Initializes the 3x3 apartment windows grid for Map 2.
 */
function initMap2Windows() {
  map2Windows = [];
  const colRel = [-0.62, 0.0, 0.62];
  const rowRel = [-0.62, 0.0, 0.62];
  
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      map2Windows.push({
        id: r * 3 + c,
        col: colRel[c],
        row: rowRel[r],
        active: false,
        yOffset: 0,
        status: 'inactive', // 'rising', 'staying', 'falling', 'dead'
        health: 100,
        lifeTimer: 0,
        color: Math.random() > 0.5 ? '#ff007f' : '#ff3333'
      });
    }
  }
}

/**
 * Draws the introduction page's boss face.
 */
function drawIntroBossFace(cx, cy, size) {
  ctx.save();

  // 1. Neck / Shirt
  ctx.fillStyle = '#ff007f';
  ctx.beginPath();
  ctx.moveTo(cx - size * 0.45, cy + size * 0.4);
  ctx.lineTo(cx + size * 0.45, cy + size * 0.4);
  ctx.quadraticCurveTo(cx, cy + size * 0.15, cx - size * 0.45, cy + size * 0.4);
  ctx.closePath();
  ctx.fill();

  // Collar V neck cut
  ctx.fillStyle = '#101421';
  ctx.beginPath();
  ctx.moveTo(cx - size * 0.1, cy + size * 0.25);
  ctx.lineTo(cx + size * 0.1, cy + size * 0.25);
  ctx.lineTo(cx, cy + size * 0.38);
  ctx.closePath();
  ctx.fill();

  // 2. Neck
  ctx.fillStyle = '#ffcc99';
  ctx.fillRect(cx - size * 0.1, cy + size * 0.15, size * 0.2, size * 0.15);

  // 3. Peach head circle
  ctx.beginPath();
  ctx.arc(cx, cy - size * 0.1, size * 0.32, 0, Math.PI * 2);
  ctx.fill();

  // Ear bumps
  ctx.beginPath();
  ctx.arc(cx - size * 0.32, cy - size * 0.1, size * 0.07, 0, Math.PI * 2);
  ctx.arc(cx + size * 0.32, cy - size * 0.1, size * 0.07, 0, Math.PI * 2);
  ctx.fill();

  // 4. Sunglasses
  ctx.fillStyle = '#000000';
  ctx.fillRect(cx - size * 0.24, cy - size * 0.18, size * 0.48, size * 0.11);

  // 5. Mustache (brown)
  ctx.fillStyle = '#5c4033';
  ctx.fillRect(cx - size * 0.16, cy, size * 0.32, size * 0.09);

  ctx.restore();
}

/**
 * Draws the watch-screen circular scope mask and tick lines.
 */
function drawScopeOverlay(centerX, centerY, scopeRadius) {
  ctx.save();

  // 1. Draw outer black mask
  ctx.beginPath();
  ctx.rect(0, 0, canvas.width, canvas.height);
  ctx.arc(centerX, centerY, scopeRadius, 0, Math.PI * 2, true);
  ctx.fillStyle = '#05070f';
  ctx.fill();

  // 2. Draw outer scope ring border
  ctx.strokeStyle = '#1b2234';
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.arc(centerX, centerY, scopeRadius, 0, Math.PI * 2);
  ctx.stroke();

  // Draw scope tick ring
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(centerX, centerY, scopeRadius - 8, 0, Math.PI * 2);
  ctx.stroke();

  // 3. Draw heavy scope crosshair lines crossing at center
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 3.5;
  
  // Horizontal line (clipped to scope)
  ctx.beginPath();
  ctx.moveTo(centerX - scopeRadius, centerY);
  ctx.lineTo(centerX + scopeRadius, centerY);
  ctx.stroke();
  
  // Vertical line
  ctx.beginPath();
  ctx.moveTo(centerX, centerY - scopeRadius);
  ctx.lineTo(centerX, centerY + scopeRadius);
  ctx.stroke();

  // Draw ticks on crosshair lines
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 2;
  for (let offset = 40; offset < scopeRadius - 30; offset += 45) {
    // Horizontal line ticks
    ctx.beginPath();
    ctx.moveTo(centerX - offset, centerY - 6);
    ctx.lineTo(centerX - offset, centerY + 6);
    ctx.moveTo(centerX + offset, centerY - 6);
    ctx.lineTo(centerX + offset, centerY + 6);
    // Vertical line ticks
    ctx.moveTo(centerX - 6, centerY - offset);
    ctx.lineTo(centerX + 6, centerY - offset);
    ctx.moveTo(centerX - 6, centerY + offset);
    ctx.lineTo(centerX + 6, centerY + offset);
    ctx.stroke();
  }

  // Draw center aim dot
  ctx.fillStyle = '#ff0055';
  ctx.beginPath();
  ctx.arc(centerX, centerY, 4, 0, Math.PI * 2);
  ctx.fill();

  // Draw text "FIRE" at the bottom of the scope
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 16px Orbitron';
  ctx.textAlign = 'center';
  ctx.fillText('FIRE', centerX, centerY + scopeRadius - 35);

  ctx.restore();
}

/**
 * Draws the sliding boss target inside an apartment window frame.
 */
function drawBaldTarget(wx, wy, ww, wh, yOffset, shirtColor, health) {
  ctx.save();
  
  // Clip drawing to window boundary so they slide behind sills
  ctx.beginPath();
  ctx.rect(wx, wy, ww, wh);
  ctx.clip();

  // Target size relative to window size
  const targetH = wh * 0.85;
  const targetW = ww * 0.7;
  const targetX = wx + (ww - targetW) / 2;
  const targetY = wy + wh - (wh * yOffset);

  // 1. Draw Shirt (Torso)
  ctx.fillStyle = shirtColor;
  ctx.beginPath();
  ctx.moveTo(targetX, targetY + targetH);
  ctx.quadraticCurveTo(targetX + targetW / 2, targetY + targetH - targetH * 0.4, targetX + targetW, targetY + targetH);
  ctx.closePath();
  ctx.fill();

  // V-neck cutout
  ctx.fillStyle = '#ffcc99'; // neck skin
  ctx.beginPath();
  ctx.moveTo(targetX + targetW * 0.4, targetY + targetH - targetH * 0.35);
  ctx.lineTo(targetX + targetW * 0.6, targetY + targetH - targetH * 0.35);
  ctx.lineTo(targetX + targetW * 0.5, targetY + targetH - targetH * 0.2);
  ctx.closePath();
  ctx.fill();

  // 2. Draw Neck
  ctx.fillRect(targetX + targetW * 0.42, targetY + targetH - targetH * 0.5, targetW * 0.16, targetH * 0.16);

  // 3. Draw Peach Head
  const headRadius = targetW * 0.3;
  const headCenterX = targetX + targetW / 2;
  const headCenterY = targetY + targetH - targetH * 0.45;
  
  ctx.beginPath();
  ctx.arc(headCenterX, headCenterY, headRadius, 0, Math.PI * 2);
  ctx.fill();

  // Ear bumps
  ctx.beginPath();
  ctx.arc(headCenterX - headRadius, headCenterY, headRadius * 0.2, 0, Math.PI * 2);
  ctx.arc(headCenterX + headRadius, headCenterY, headRadius * 0.2, 0, Math.PI * 2);
  ctx.fill();

  // 4. Sunglasses
  ctx.fillStyle = '#000000';
  ctx.fillRect(headCenterX - headRadius * 0.75, headCenterY - headRadius * 0.25, headRadius * 1.5, headRadius * 0.32);

  // 5. Mustache
  ctx.fillStyle = '#5c4033'; // brown
  ctx.fillRect(headCenterX - headRadius * 0.5, headCenterY + headRadius * 0.2, headRadius * 1.0, headRadius * 0.25);

  // 6. Draw red damage flash overlay
  if (health < 100) {
    ctx.fillStyle = 'rgba(255, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.arc(headCenterX, headCenterY, headRadius, 0, Math.PI * 2);
    ctx.fill();
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
  
  // Map 2 Intro transition
  if (activeMap === 2 && map2Stage === 'intro') {
    map2Stage = 'play';
    playLevelUpSound();
    initMap2Windows();
    lastMap2SpawnTime = Date.now();
    return;
  }

  // Apply expansion pulse on crosshair
  ch.shootPulse = 1.0;

  // Retrieve current weapon configuration
  const activeWeaponKey = player.currentWeapon || 'plasma';
  const weapon = WEAPONS[activeWeaponKey] || WEAPONS.plasma;

  if (isCharged) {
    // 1. Quantum Mega-Beam Power Attack
    playPowerAttackSound();
    
    // Draw screen-wide mega beam
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

    // Blast rings
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

    if (activeMap === 2) {
      // Map 2 Mega-Blast (160px radius check)
      const blastRadius = 160;
      map2Windows.forEach(w => {
        if (w.active && w.status !== 'dead') {
          const headCenterX = w.pixelX + w.pixelW / 2;
          const headCenterY = w.pixelY + w.pixelH - (w.pixelH * w.yOffset) + (w.pixelH * 0.85) - (w.pixelH * 0.85 * 0.45);
          
          const dx = headCenterX - ch.x;
          const dy = headCenterY - ch.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          
          if (dist < blastRadius) {
            w.status = 'dead';
            w.health = 0;
            spawnParticles(headCenterX, headCenterY, '#00ff66', 25);
            
            floatingTexts.push({
              x: headCenterX,
              y: headCenterY - 25,
              text: 'MEGA-BLAST SHATTER! +100',
              color: '#00ff66',
              scale: 1.2,
              alpha: 1.0,
              vy: -1.2
            });
            connection.sendPlayerHit(playerId, 'body');
          }
        }
      });
    } else {
      // Map 1 Mega-Blast (160px radius check)
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

            connection.sendPlayerHit(playerId, 'body');

            targets.splice(i, 1);
            spawnSingleTarget();
          }
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

  if (activeMap === 2) {
    // Map 2: Sniper Apartment Windows Targets Collision
    for (let i = 0; i < map2Windows.length; i++) {
      const w = map2Windows[i];
      if (w.active && (w.status === 'rising' || w.status === 'staying' || w.status === 'falling')) {
        const targetW = w.pixelW * 0.7;
        const targetH = w.pixelH * 0.85;
        const targetX = w.pixelX + (w.pixelW - targetW) / 2;
        const targetY = w.pixelY + w.pixelH - (w.pixelH * w.yOffset);

        const headCenterX = targetX + targetW / 2;
        const headCenterY = targetY + targetH - targetH * 0.45;
        const headRadius = targetW * 0.3;
        const headHitbox = Math.max(headRadius, 25);

        // Check Headshot
        const dxHead = ch.x - headCenterX;
        const dyHead = ch.y - headCenterY;
        const distHead = Math.sqrt(dxHead * dxHead + dyHead * dyHead);

        if (distHead < headHitbox) {
          w.status = 'dead';
          w.health = 0;
          playHitSound('head');
          spawnParticles(headCenterX, headCenterY, '#ff007f', 28);

          floatingTexts.push({
            x: headCenterX,
            y: headCenterY - 25,
            text: 'CRITICAL HEADSHOT! +200',
            color: '#ff007f',
            scale: 1.4,
            alpha: 1.0,
            vy: -1.5
          });

          connection.sendPlayerHit(playerId, 'head');
          break;
        }

        // Check Body hit
        const bodyCenterX = targetX + targetW / 2;
        const bodyCenterY = targetY + targetH - targetH * 0.15;
        const dxBody = Math.abs(ch.x - bodyCenterX);
        const dyBody = Math.abs(ch.y - bodyCenterY);

        if (dxBody < 30 && dyBody < 35) {
          w.health -= 50;
          w.flashTime = Date.now() + 150;

          if (w.health <= 0) {
            w.status = 'dead';
            playHitSound('body');
            spawnParticles(bodyCenterX, bodyCenterY, '#00f2fe', 20);

            floatingTexts.push({
              x: bodyCenterX,
              y: bodyCenterY - 25,
              text: 'ROBOT ELIMINATED! +100',
              color: '#00f2fe',
              scale: 1.1,
              alpha: 1.0,
              vy: -1.2
            });

            connection.sendPlayerHit(playerId, 'body');
          } else {
            playHitSound('body');
            spawnParticles(bodyCenterX, bodyCenterY, 'rgba(255,255,255,0.8)', 8);

            floatingTexts.push({
              x: bodyCenterX,
              y: bodyCenterY - 25,
              text: 'TARGET HIT! 50%',
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
  } else {
    // Map 1: Cyber Canyon Targets Collision
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

  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const scopeRadius = Math.min(canvas.width, canvas.height) * 0.44;

  // Map 2: Introduction presentation screen
  if (activeMap === 2 && map2Stage === 'intro') {
    ctx.fillStyle = '#05070f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Watch scope border
    ctx.strokeStyle = '#1b2234';
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.arc(centerX, centerY, scopeRadius, 0, Math.PI * 2);
    ctx.stroke();

    // Watch face background
    ctx.fillStyle = '#101421';
    ctx.beginPath();
    ctx.arc(centerX, centerY, scopeRadius - 6, 0, Math.PI * 2);
    ctx.fill();

    // Poster Title
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px Orbitron';
    ctx.textAlign = 'center';
    ctx.fillText('TARGET #1', centerX, centerY - scopeRadius * 0.55);

    // Draw the boss face
    drawIntroBossFace(centerX, centerY, scopeRadius * 0.45);

    // Prompt text
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.font = '700 13px Orbitron';
    ctx.fillText('TAP TO CONTINUE', centerX, centerY + scopeRadius * 0.6);
    
    // Render connected players crosshairs so they can calibrate
    playerManager.players.forEach(player => {
      if (player.connected) {
        drawCrosshair(player.crosshair);
      }
    });
    return;
  }

  // 1. Update player crosshair smooth interpolations
  playerManager.players.forEach(player => {
    if (!player.connected) return;
    const ch = player.crosshair;
    ch.x += (ch.targetX - ch.x) * smoothing;
    ch.y += (ch.targetY - ch.y) * smoothing;

    ch.x = Math.max(ch.radius, Math.min(canvas.width - ch.radius, ch.x));
    ch.y = Math.max(ch.radius, Math.min(canvas.height - ch.radius, ch.y));

    if (ch.shootPulse > 0) {
      ch.shootPulse -= 0.1;
    }
  });

  // 2. Branch updates depending on active map
  if (activeMap === 1) {
    // Map 1: Canyon bending and robot tracking
    curvePhase += 0.006;
    targetCurve = Math.sin(curvePhase) * Math.cos(curvePhase * 0.6) * 1.6;
    trackCurve += (targetCurve - trackCurve) * 0.015;

    const now = Date.now();
    for (let i = targets.length - 1; i >= 0; i--) {
      const target = targets[i];
      if (target.opacity < target.targetOpacity) {
        target.opacity += 16.67 / targetFadeTime;
        if (target.opacity > target.targetOpacity) target.opacity = target.targetOpacity;
      }
      if (target.lockRingProgress > 0) {
        target.lockRingProgress -= 0.04;
        if (target.lockRingProgress < 0) target.lockRingProgress = 0;
      }
      target.z -= mapSpeed;
      if (target.z <= 0.5 || (now - target.spawnTime > target.lifespan)) {
        targets.splice(i, 1);
        spawnSingleTarget();
      }
    }
  } else {
    // Map 2: Window popups cycles
    const activeWindowTargets = map2Windows.filter(w => w.active);
    if (activeWindowTargets.length < maxTargets && Date.now() - lastMap2SpawnTime > 1500) {
      const inactive = map2Windows.filter(w => !w.active);
      if (inactive.length > 0) {
        const selected = inactive[Math.floor(Math.random() * inactive.length)];
        selected.active = true;
        selected.status = 'rising';
        selected.yOffset = 0;
        selected.health = 100;
        selected.color = Math.random() > 0.5 ? '#ff007f' : '#ff3333';
        selected.lifeTimer = 0;
        lastMap2SpawnTime = Date.now();
      }
    }

    map2Windows.forEach(w => {
      if (!w.active) return;
      if (w.status === 'rising') {
        w.yOffset += 0.05;
        if (w.yOffset >= 1.0) {
          w.yOffset = 1.0;
          w.status = 'staying';
          w.lifeTimer = Date.now() + 2500;
        }
      } else if (w.status === 'staying') {
        if (Date.now() > w.lifeTimer) {
          w.status = 'falling';
        }
      } else if (w.status === 'falling') {
        w.yOffset -= 0.05;
        if (w.yOffset <= 0) {
          w.active = false;
          w.status = 'inactive';
        }
      } else if (w.status === 'dead') {
        w.yOffset -= 0.12;
        if (w.yOffset <= 0) {
          w.active = false;
          w.status = 'inactive';
        }
      }
    });
  }

  // 3. Update particle/beams/flashes physics
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.alpha -= p.decay;
    if (p.alpha <= 0) {
      particles.splice(i, 1);
    }
  }

  for (let i = laserTrails.length - 1; i >= 0; i--) {
    const trail = laserTrails[i];
    trail.alpha -= 0.12;
    if (trail.alpha <= 0) {
      laserTrails.splice(i, 1);
    }
  }

  for (let i = muzzleFlashes.length - 1; i >= 0; i--) {
    const mf = muzzleFlashes[i];
    mf.radius += 3.5;
    mf.alpha -= 0.1;
    if (mf.alpha <= 0) {
      muzzleFlashes.splice(i, 1);
    }
  }

  // 4. Fill base frames
  ctx.fillStyle = '#05070f';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (activeMap === 2) {
    // Map 2: Draw Sniper Apartment clipped inside circular scope viewport
    ctx.save();
    ctx.beginPath();
    ctx.arc(centerX, centerY, scopeRadius, 0, Math.PI * 2);
    ctx.clip();

    // Brick Wall
    ctx.fillStyle = '#9e4629';
    ctx.fillRect(centerX - scopeRadius, centerY - scopeRadius, scopeRadius * 2, scopeRadius * 2);

    // Brick rows
    ctx.strokeStyle = '#7c2f18';
    ctx.lineWidth = 1.5;
    for (let y = centerY - scopeRadius; y <= centerY + scopeRadius; y += 30) {
      ctx.beginPath();
      ctx.moveTo(centerX - scopeRadius, y);
      ctx.lineTo(centerX + scopeRadius, y);
      ctx.stroke();
    }

    // Windows Grid
    map2Windows.forEach(w => {
      const wx = centerX + w.col * scopeRadius - (scopeRadius * 0.16);
      const wy = centerY + w.row * scopeRadius - (scopeRadius * 0.14);
      const ww = scopeRadius * 0.32;
      const wh = scopeRadius * 0.28;

      w.pixelX = wx;
      w.pixelY = wy;
      w.pixelW = ww;
      w.pixelH = wh;

      // Dark window pane interiors
      ctx.strokeStyle = '#4a2511';
      ctx.lineWidth = 4;
      ctx.fillStyle = '#22252a';
      ctx.fillRect(wx, wy, ww, wh);
      ctx.strokeRect(wx, wy, ww, wh);

      // Glass dividers
      ctx.strokeStyle = '#4a2511';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(wx + ww / 2, wy);
      ctx.lineTo(wx + ww / 2, wy + wh);
      ctx.moveTo(wx, wy + wh / 2);
      ctx.lineTo(wx + ww, wy + wh / 2);
      ctx.stroke();

      // Draw active sliding target
      if (w.active) {
        drawBaldTarget(wx, wy, ww, wh, w.yOffset, w.color, w.health);
      }
    });

    ctx.restore();
  } else {
    // Map 1: Draw Cyber Canyon elements
    drawGrid();
    updateAndDrawTowers();
    targets.forEach((target) => {
      drawWalkingRobot(target);
    });
  }

  // 5. Draw particles overlay
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

  // Draw sniper scope ticks and borders on Map 2
  if (activeMap === 2) {
    drawScopeOverlay(centerX, centerY, scopeRadius);
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

  // Reset Map 2 variables if active
  if (activeMap === 2) {
    map2Stage = 'intro';
    initMap2Windows();
    lastMap2SpawnTime = 0;
  }
  
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

// Listen to Map changes from the mobile controller
connection.onMapChanged = (mapId) => {
  activeMap = mapId;
  const mapBtn1 = document.getElementById('map-btn-1');
  const mapBtn2 = document.getElementById('map-btn-2');

  if (mapBtn1 && mapBtn2) {
    if (activeMap === 1) {
      mapBtn1.classList.add('active');
      mapBtn2.classList.remove('active');
    } else {
      mapBtn1.classList.remove('active');
      mapBtn2.classList.add('active');
    }
  }
};

connection.connect();

// Trigger QR setup
window.addEventListener('DOMContentLoaded', generateLobbyQR);
