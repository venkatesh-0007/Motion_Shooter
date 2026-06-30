import { CONNECTION_STATES } from '/shared/constants.js';
import { MobileController } from '/sdk/mobile.js';

// DOM Elements
const statusIndicator = document.getElementById('status-indicator');
const touchPad = document.getElementById('touch-pad');
const recenterBtn = document.getElementById('recenter-btn');
const permissionOverlay = document.getElementById('permission-overlay');
const enableSensorsBtn = document.getElementById('enable-sensors-btn');

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

// Session extraction
const urlParams = new URLSearchParams(window.location.search);
let sessionId = urlParams.get('session');

// Join UI Elements
const joinOverlay = document.getElementById('join-overlay');
const joinCodeInput = document.getElementById('join-code-input');
const joinSessionBtn = document.getElementById('join-session-btn');

/**
 * Updates the screen status banner based on WS state.
 * @param {string} state Connection state (WAITING, CONNECTED, etc.)
 */
function handleStatusChange(state) {
  const isConnectedVal = state === CONNECTION_STATES.CONNECTED;

  if (isConnectedVal) {
    isConnected = true;
    statusIndicator.textContent = 'Controller Connected ✅';
    statusIndicator.className = 'status connected';
  } else {
    isConnected = false;
    statusIndicator.textContent = 'Waiting for game client...';
    statusIndicator.className = 'status waiting';
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
    simulatedOrientation.gamma += dx * 0.25;
    simulatedOrientation.beta += dy * 0.25;

    // Clamp simulated orientation values to reasonable gyro ranges
    simulatedOrientation.gamma = Math.max(-90, Math.min(90, simulatedOrientation.gamma));
    simulatedOrientation.beta = Math.max(-90, Math.min(90, simulatedOrientation.beta));

    latestOrientation.gamma = simulatedOrientation.gamma;
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

function initSession() {
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
