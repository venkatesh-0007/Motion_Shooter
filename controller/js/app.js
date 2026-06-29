import { MSG_TYPES, CONNECTION_STATES } from '/shared/constants.js';
import { ControllerConnection } from './connection.js';

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
let sendPacketCount = 0;

let eventCount = 0;
let hasLoggedFirstEvent = false;

// Log: App Loaded
console.log('App Loaded');

/**
 * Updates the screen status banner based on WS state.
 * @param {string} state Connection state (WAITING, CONNECTED, etc.)
 */
function handleStatusChange(state) {
  const isConnectedVal = state === CONNECTION_STATES.CONNECTED;
  const debugConnectedEl = document.getElementById('debug-connected');
  if (debugConnectedEl) {
    debugConnectedEl.textContent = isConnectedVal ? 'Yes' : 'No';
  }

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
    eventCount++;

    // Log: First orientation event received
    if (!hasLoggedFirstEvent) {
      hasLoggedFirstEvent = true;
      console.log('First orientation event received');
      console.log('First event coordinates:', {
        alpha: event.alpha,
        beta: event.beta,
        gamma: event.gamma
      });
    }

    if (eventCount % 60 === 0) {
      console.log(`[SENSOR DEBUG] Event count: ${eventCount}. Alpha: ${event.alpha}, Beta: ${event.beta}, Gamma: ${event.gamma}`);
    }

    // Update debug text instantly
    const alphaEl = document.getElementById('debug-alpha');
    const betaEl = document.getElementById('debug-beta');
    const gammaEl = document.getElementById('debug-gamma');
    const countEl = document.getElementById('debug-events-count');

    if (alphaEl) alphaEl.textContent = event.alpha !== null ? event.alpha.toFixed(2) : 'null';
    if (betaEl) betaEl.textContent = event.beta !== null ? event.beta.toFixed(2) : 'null';
    if (gammaEl) gammaEl.textContent = event.gamma !== null ? event.gamma.toFixed(2) : 'null';
    if (countEl) countEl.textContent = eventCount;

    // Only capture if we receive valid coordinates
    if (event.alpha !== null && event.beta !== null) {
      latestOrientation.alpha = event.alpha;
      latestOrientation.beta = event.beta;
      latestOrientation.gamma = event.gamma;
      hasNewData = true;
    }
  }, true);

  // Log: Listener attached
  console.log('Listener attached');
  
  const listeningEl = document.getElementById('debug-listening');
  if (listeningEl) {
    listeningEl.textContent = 'Yes';
  }
}

/**
 * Checks orientation API availability and manages permissions.
 */
function checkSensors() {
  injectDebugFields();

  // START NETWORKING IMMEDIATELY
  // Unconditionally connect WebSocket so game always connects (restoring baseline)
  connection = new ControllerConnection(handleStatusChange);
  connection.connect();
  requestAnimationFrame(sendLoop);

  const isSecure = window.isSecureContext;
  const warningEl = document.getElementById('secure-context-warning');
  if (!isSecure) {
    console.warn("⚠️ INSECURE HTTP ORIGIN: Mobile browsers generally disable DeviceOrientation API over HTTP. Please use chrome://flags or serve via HTTPS.");
    if (warningEl) {
      warningEl.style.display = 'block';
    }
  }

  // 1. Verify DeviceOrientationEvent support
  let isSupported = true;
  if (typeof DeviceOrientationEvent === 'undefined') {
    isSupported = false;
  }
  
  // Log: DeviceOrientation supported
  console.log(`DeviceOrientation supported: ${isSupported ? 'Yes' : 'No'}`);

  const supportedEl = document.getElementById('debug-supported');
  if (supportedEl) {
    supportedEl.textContent = isSupported ? 'Yes' : 'No';
  }

  if (isSupported) {
    // Platform check
    const ua = navigator.userAgent.toLowerCase();
    const isAndroid = /android/i.test(ua);
    const isIOS = /ipad|iphone|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const platform = isAndroid ? 'Android' : (isIOS ? 'iOS' : 'Other');

    // Log: Platform detected
    console.log(`Platform detected: ${platform}`);

    // iOS-specific permission check
    const hasRequestPermission = typeof DeviceOrientationEvent.requestPermission === 'function';
    const permissionEl = document.getElementById('debug-permission');

    if (isIOS && hasRequestPermission) {
      if (permissionEl) permissionEl.textContent = 'Required (Pending)';
      
      permissionOverlay.classList.remove('hidden');
      enableSensorsBtn.addEventListener('click', () => {
        DeviceOrientationEvent.requestPermission()
          .then((response) => {
            console.log(`iOS Permission response: ${response}`);
            if (response === 'granted') {
              console.log('Permission granted');
              if (permissionEl) {
                permissionEl.textContent = 'Granted';
              }
              permissionOverlay.classList.add('hidden');
              attachSensorListener();
            } else {
              console.warn('Permission denied');
              if (permissionEl) {
                permissionEl.textContent = 'Denied';
              }
              alert('Sensor permission denied. The game controller requires orientation sensors to run.');
            }
          })
          .catch((error) => {
            console.error('Permission request error:', error);
            if (permissionEl) {
              permissionEl.textContent = 'Error';
            }
          });
      });
    } else {
      // Android (S24) Chrome: register immediately, do NOT require requestPermission()
      if (permissionEl) {
        permissionEl.textContent = 'Not Required';
      }
      attachSensorListener();
    }
  } else {
    console.error('[DIAGNOSTIC] DeviceOrientationEvent is undefined in this browser.');
  }
}

/**
 * Dynamically injects new fields into the debug overlay.
 */
function injectDebugFields() {
  const debugOverlay = document.getElementById('debug-overlay');
  if (debugOverlay && !document.getElementById('debug-supported')) {
    const fields = `
      <hr style="border: 0; border-top: 1px dashed rgba(0, 242, 254, 0.3); margin: 6px 0;">
      <div>Supported: <span id="debug-supported">-</span></div>
      <div>Permission: <span id="debug-permission">-</span></div>
      <div>Listening: <span id="debug-listening">No</span></div>
      <div>Events Received: <span id="debug-events-count">0</span></div>
    `;
    debugOverlay.insertAdjacentHTML('beforeend', fields);
  }
}

/**
 * Loops and sends orientation changes if data is available and is connected.
 * @param {number} timestamp DOMHighResTimeStamp
 */
function sendLoop(timestamp) {
  requestAnimationFrame(sendLoop);

  if (timestamp - lastSendTime >= SEND_INTERVAL) {
    const debugSendingEl = document.getElementById('debug-sending');
    if (hasNewData && isConnected) {
      const payload = {
        type: MSG_TYPES.ORIENTATION,
        payload: {
          alpha: Number(latestOrientation.alpha.toFixed(2)),
          beta: Number(latestOrientation.beta.toFixed(2)),
          gamma: Number(latestOrientation.gamma.toFixed(2))
        }
      };
      connection.send(payload);

      sendPacketCount++;
      if (debugSendingEl) {
        debugSendingEl.textContent = sendPacketCount;
      }
      hasNewData = false;
    } else {
      if (debugSendingEl) {
        debugSendingEl.textContent = isConnected ? 'Waiting for sensor data...' : 'Not paired';
      }
    }
    lastSendTime = timestamp;
  }
}

/**
 * Triggers a recenter event.
 */
function triggerRecenter() {
  if (!isConnected) return;
  console.log('[CONTROLLER RECENTER] Tapped Recenter. Sending RECENTER signal.');
  connection.send({ type: MSG_TYPES.RECENTER });
}

/**
 * Triggers a shoot event and flashes the background.
 */
function triggerShoot() {
  if (!isConnected) return;
  console.log('[CONTROLLER SHOOT] Tapped trigger. Sending SHOOT signal.');
  connection.send({ type: MSG_TYPES.SHOOT });

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

touchPad.addEventListener('touchstart', (e) => {
  e.preventDefault(); // Prevents zooming and default tapping behaviors
  triggerShoot();
}, { passive: false });

// Start sensor check flow
window.addEventListener('DOMContentLoaded', checkSensors);
