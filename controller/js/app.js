import { CONNECTION_STATES } from '/shared/constants.js';
import { MobileController } from '/sdk/mobile.js';

// DOM Elements
const statusIndicator = document.getElementById('status-indicator');
const touchPad = document.getElementById('touch-pad');
const recenterBtn = document.getElementById('recenter-btn');
const permissionOverlay = document.getElementById('permission-overlay');
const enableSensorsBtn = document.getElementById('enable-sensors-btn');
const settingsToggleBtn = document.getElementById('settings-toggle-btn');
const settingsOverlay = document.getElementById('settings-overlay');
const settingsSaveBtn = document.getElementById('settings-save-btn');
const settingsSensitivityInput = document.getElementById('settings-sensitivity');
const sensDisplayVal = document.getElementById('sens-display-val');

let connection = null;
let isConnected = false;
let latestOrientation = { alpha: 0, beta: 0, gamma: 0 };
let hasNewData = false;
let lastSendTime = 0;
const SEND_INTERVAL = 1000 / 60; // Max 60 FPS

// Gyro activity tracking and Touch Aiming Fallback variables
let isGyroActive = false;
let simulatedOrientation = { alpha: 0, beta: 0, gamma: 0 };
let startTouch = null;
let isDragging = false;

// Local Settings State
let settings = { playerName: 'Player', sensitivity: 1.0, invertX: false, invertY: false };

// Session extraction
const urlParams = new URLSearchParams(window.location.search);
let sessionId = urlParams.get('session');

// Join UI Elements
const joinOverlay = document.getElementById('join-overlay');
const joinCodeInput = document.getElementById('join-code-input');
const joinSessionBtn = document.getElementById('join-session-btn');

/**
 * Updates the screen status banner based on WS state and game progress.
 */
function handleStatusChange(state, gameState) {
  const isConnectedVal = state === CONNECTION_STATES.CONNECTED;

  if (isConnectedVal) {
    isConnected = true;
    statusIndicator.textContent = 'Controller Connected ✅';
    statusIndicator.className = 'status connected';
    
    // Toggle lobby screen overlay based on game status
    const lobbyOverlay = document.getElementById('lobby-overlay');
    if (lobbyOverlay) {
      if (gameState === 'lobby') {
        lobbyOverlay.classList.remove('hidden');
      } else {
        lobbyOverlay.classList.add('hidden');
      }
    }
  } else {
    isConnected = false;
    statusIndicator.textContent = 'Waiting for game client...';
    statusIndicator.className = 'status waiting';

    // Hide lobby overlay on disconnect
    const lobbyOverlay = document.getElementById('lobby-overlay');
    if (lobbyOverlay) {
      lobbyOverlay.classList.add('hidden');
    }
  }
}

/**
 * Sets up the event listener for DeviceOrientation.
 */
function attachSensorListener() {
  window.addEventListener('deviceorientation', (event) => {
    // Only capture if we receive valid coordinates
    if (event.alpha !== null && event.beta !== null) {
      isGyroActive = true;
      latestOrientation.alpha = event.alpha;
      latestOrientation.beta = event.beta;
      latestOrientation.gamma = event.gamma;
      hasNewData = true;
    }
  }, true);
}

/**
 * Checks orientation API availability and manages permissions.
 */
function checkSensors() {
  // START NETWORKING IMMEDIATELY
  // Unconditionally connect WebSocket so game always connects (restoring baseline)
  connection = new MobileController(sessionId, handleStatusChange);
  connection.onGameStart = () => {
    const lobbyOverlay = document.getElementById('lobby-overlay');
    if (lobbyOverlay) {
      lobbyOverlay.classList.add('hidden');
    }
  };
  connection.connect();
  requestAnimationFrame(sendLoop);

  const isSecure = window.isSecureContext;
  if (!isSecure) {
    console.error("⚠️ INSECURE HTTP ORIGIN: Mobile browsers generally disable DeviceOrientation API over HTTP. Please use chrome://flags or serve via HTTPS.");
    const warningBanner = document.getElementById('insecure-warning');
    if (warningBanner) {
      warningBanner.classList.remove('hidden');
    }
  }

  // 1. Verify DeviceOrientationEvent support
  let isSupported = typeof DeviceOrientationEvent !== 'undefined';

  if (isSupported) {
    // Platform check
    const ua = navigator.userAgent.toLowerCase();
    const isAndroid = /android/i.test(ua);
    const isIOS = /ipad|iphone|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    // iOS-specific permission check
    const hasRequestPermission = typeof DeviceOrientationEvent.requestPermission === 'function';
    if (isIOS && hasRequestPermission) {
      permissionOverlay.classList.remove('hidden');
      enableSensorsBtn.addEventListener('click', () => {
        DeviceOrientationEvent.requestPermission()
          .then((response) => {
            if (response === 'granted') {
              permissionOverlay.classList.add('hidden');
              attachSensorListener();
            } else {
              console.error('Permission denied');
              alert('Sensor permission denied. The game controller requires orientation sensors to run.');
            }
          })
          .catch((error) => {
            console.error('Permission request error:', error);
          });
      });
    } else {
      // Android or other browsers that don't require permission request
      attachSensorListener();
    }
  } else {
    console.error('[DIAGNOSTIC] DeviceOrientationEvent is undefined in this browser.');
  }
}


/**
 * Loops and sends orientation changes if data is available and is connected.
 * @param {number} timestamp DOMHighResTimeStamp
 */
function sendLoop(timestamp) {
  requestAnimationFrame(sendLoop);

  if (timestamp - lastSendTime >= SEND_INTERVAL) {
    if (hasNewData && isConnected) {
      connection.sendOrientation(
        Number(latestOrientation.alpha.toFixed(2)),
        Number(latestOrientation.beta.toFixed(2)),
        Number(latestOrientation.gamma.toFixed(2))
      );

      hasNewData = false;
    }
    lastSendTime = timestamp;
  }
}

/**
 * Triggers a recenter event.
 */
function triggerRecenter() {
  if (!isConnected) return;
  if (!isGyroActive) {
    simulatedOrientation = { alpha: 0, beta: 0, gamma: 0 };
    latestOrientation = { alpha: 0, beta: 0, gamma: 0 };
    hasNewData = true;
  }
  connection.recenter();
}

/**
 * Triggers a shoot event and flashes the background.
 */
function triggerShoot() {
  if (!isConnected) return;
  connection.sendShoot();

  // Visual firing feedback
  touchPad.classList.add('firing');
  setTimeout(() => {
    touchPad.classList.remove('firing');
  }, 100);
}

// Attach Touchpad Events (Ensuring Recenter clicks are isolated)
recenterBtn.addEventListener('touchstart', (e) => {
  e.stopPropagation();
  triggerRecenter();
}, { passive: true });

recenterBtn.addEventListener('click', (e) => {
  e.stopPropagation();
});

// Touchpad Drag-to-Aim & Tap-to-Shoot fallback
touchPad.addEventListener('touchstart', (e) => {
  e.preventDefault(); // Prevents zooming and default tapping behaviors
  const touch = e.touches[0];
  startTouch = { x: touch.clientX, y: touch.clientY, time: Date.now() };
  isDragging = false;
}, { passive: false });

touchPad.addEventListener('touchmove', (e) => {
  e.preventDefault();
  if (!startTouch) return;

  // If orientation sensor is active, don't use touch-drag aiming
  if (isGyroActive) return;

  const touch = e.touches[0];
  const dx = touch.clientX - startTouch.x;
  const dy = touch.clientY - startTouch.y;

  // Threshold to distinguish dragging from simple tap jitter
  if (!isDragging && Math.sqrt(dx * dx + dy * dy) > 8) {
    isDragging = true;
  }

  if (isDragging) {
    // Modify simulated orientation
    // Sensitivity scale: 0.25 degrees per pixel
    const invX = settings.invertX ? -1 : 1;
    const invY = settings.invertY ? -1 : 1;

    simulatedOrientation.alpha = (simulatedOrientation.alpha - dx * 0.25 * invX) % 360;
    if (simulatedOrientation.alpha < 0) simulatedOrientation.alpha += 360;

    simulatedOrientation.beta -= dy * 0.25 * invY;
    simulatedOrientation.beta = Math.max(-90, Math.min(90, simulatedOrientation.beta));

    latestOrientation.alpha = simulatedOrientation.alpha;
    latestOrientation.beta = simulatedOrientation.beta;
    hasNewData = true;

    // Reset touch coordinates for relative drag motion
    startTouch.x = touch.clientX;
    startTouch.y = touch.clientY;
  }
}, { passive: false });

touchPad.addEventListener('touchend', (e) => {
  e.preventDefault();
  if (!startTouch) return;

  const elapsed = Date.now() - startTouch.time;
  // If it was a quick touch and they didn't drag, treat it as a trigger shoot
  if (!isDragging && elapsed < 250) {
    triggerShoot();
  }

  startTouch = null;
  isDragging = false;
}, { passive: false });

function loadSettings() {
  try {
    const stored = localStorage.getItem('motion_shooter_settings');
    if (stored) {
      settings = { ...settings, ...JSON.parse(stored) };
    }
  } catch (e) {
    console.error('Failed to load settings:', e);
  }

  // Populate UI inputs
  const nameInput = document.getElementById('settings-player-name');
  if (nameInput) nameInput.value = settings.playerName;
  if (settingsSensitivityInput) {
    settingsSensitivityInput.value = settings.sensitivity;
    sensDisplayVal.textContent = Number(settings.sensitivity).toFixed(1);
  }
  const invXInput = document.getElementById('settings-invert-x');
  if (invXInput) invXInput.checked = settings.invertX;
  const invYInput = document.getElementById('settings-invert-y');
  if (invYInput) invYInput.checked = settings.invertY;
}

function saveSettings() {
  const nameInput = document.getElementById('settings-player-name');
  const invXInput = document.getElementById('settings-invert-x');
  const invYInput = document.getElementById('settings-invert-y');

  if (nameInput) settings.playerName = nameInput.value.trim() || 'Player';
  if (settingsSensitivityInput) settings.sensitivity = parseFloat(settingsSensitivityInput.value);
  if (invXInput) settings.invertX = invXInput.checked;
  if (invYInput) settings.invertY = invYInput.checked;

  try {
    localStorage.setItem('motion_shooter_settings', JSON.stringify(settings));
  } catch (e) {
    console.error('Failed to save settings:', e);
  }

  // Send update to server if connected
  if (connection && isConnected) {
    connection.sendSettings(settings);
  }
}

function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  } else {
    // Insecure HTTP contexts clipboard fallback
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.top = '-9999px';
    textArea.style.left = '-9999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);
      if (successful) {
        return Promise.resolve();
      } else {
        return Promise.reject(new Error('Fallback copy failed'));
      }
    } catch (err) {
      document.body.removeChild(textArea);
      return Promise.reject(err);
    }
  }
}

function initSession() {
  loadSettings();

  // Set up insecure origin guide display and copy utilities
  const originText = document.getElementById('origin-text');
  if (originText) {
    originText.textContent = window.location.origin;
  }

  const warningHeaderToggle = document.getElementById('warning-header-toggle');
  const warningDetails = document.getElementById('warning-details');
  if (warningHeaderToggle && warningDetails) {
    warningHeaderToggle.addEventListener('click', () => {
      warningDetails.classList.toggle('hidden');
    });
  }

  const copyOriginBtn = document.getElementById('copy-origin-btn');
  if (copyOriginBtn) {
    copyOriginBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const origin = window.location.origin;
      copyToClipboard(origin).then(() => {
        copyOriginBtn.textContent = 'Copied! ✅';
        copyOriginBtn.classList.add('success');
        setTimeout(() => {
          copyOriginBtn.textContent = 'Copy';
          copyOriginBtn.classList.remove('success');
        }, 2000);
      }).catch(err => {
        console.error('Copy failed:', err);
        alert('Failed to copy. Please manually copy the origin.');
      });
    });
  }

  const copyFlagsBtn = document.getElementById('copy-flags-btn');
  if (copyFlagsBtn) {
    copyFlagsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const origin = window.location.origin;
      copyToClipboard(origin).then(() => {
        copyFlagsBtn.textContent = 'Origin Copied! ✅';
        copyFlagsBtn.classList.add('success');
        
        setTimeout(() => {
          copyFlagsBtn.textContent = 'Copy Link';
          copyFlagsBtn.classList.remove('success');
          
          // Attempt redirect to chrome://flags
          try {
            window.location.href = 'chrome://flags/#unsafely-treat-insecure-origin-as-secure';
          } catch (err) {
            console.error('Redirect failed:', err);
          }
          
          alert('Server origin (' + origin + ') copied to clipboard!\n\nNote: Browsers block direct redirects to chrome://flags for security. Please paste chrome://flags in your browser address bar to enable the flag.');
        }, 800);
      }).catch(err => {
        console.error('Copy failed:', err);
        alert('Failed to copy. Please manually copy the origin.');
      });
    });
  }

  // Settings range slider listener
  if (settingsSensitivityInput && sensDisplayVal) {
    settingsSensitivityInput.addEventListener('input', (e) => {
      sensDisplayVal.textContent = Number(e.target.value).toFixed(1);
    });
  }

  // Settings toggle overlay listeners
  if (settingsToggleBtn && settingsOverlay) {
    settingsToggleBtn.addEventListener('click', () => {
      loadSettings(); // Reload to sync state
      settingsOverlay.classList.remove('hidden');
    });
  }

  if (settingsSaveBtn && settingsOverlay) {
    settingsSaveBtn.addEventListener('click', () => {
      saveSettings();
      settingsOverlay.classList.add('hidden');
    });
  }

  if (sessionId && sessionId.trim().length > 0) {
    if (joinOverlay) joinOverlay.classList.add('hidden');
    checkSensors();
  } else {
    if (joinOverlay) joinOverlay.classList.remove('hidden');
    if (joinSessionBtn && joinCodeInput) {
      joinSessionBtn.addEventListener('click', () => {
        const val = joinCodeInput.value.trim().toUpperCase();
        if (val.length > 0) {
          sessionId = val;
          window.history.replaceState(null, '', `?session=${sessionId}`);
          joinOverlay.classList.add('hidden');
          checkSensors();
        }
      });
    }
  }
}

// Start initialization flow
window.addEventListener('DOMContentLoaded', initSession);
