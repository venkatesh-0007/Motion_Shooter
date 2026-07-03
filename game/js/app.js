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
const MAX_TARGETS = 3;

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

  // Check overlap collision with active targets
  for (let i = targets.length - 1; i >= 0; i--) {
    const target = targets[i];
    const dx = ch.x - target.x;
    const dy = ch.y - target.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Overlap condition (crosshair cursor hits circle bounds)
    if (distance < target.radius) {
      // Spawn score explosion particles
      spawnParticles(target.x, target.y, target.color, 20);

      // Remove target and spawn replacement
      targets.splice(i, 1);
      spawnSingleTarget();

      // Notify server about the hit
      connection.sendPlayerHit(playerId);
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

  // Draw Crosshairs for all active players
  playerManager.players.forEach(player => {
    if (player.connected) {
      drawCrosshair(player.crosshair);
    }
  });
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
    playerData.invertY
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

connection.onPlayerStatsUpdated = (playerId, statsPayload) => {
  playerManager.updateStats(playerId, statsPayload.score, statsPayload.shots, statsPayload.hits);
  updateLeaderboardUI();
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

    entry.innerHTML = `
      <div class="leaderboard-entry-left">
        <span class="player-dot" style="color: ${player.crosshair.color}; background: ${player.crosshair.color};"></span>
        <span class="leaderboard-name">${player.playerName}</span>
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
const startBtn = document.getElementById('start-game-btn');
if (startBtn) {
  startBtn.addEventListener('click', startGame);
}

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
