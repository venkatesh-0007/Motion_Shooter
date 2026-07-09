import { CONNECTION_STATES, WEAPONS } from '/shared/constants.js';
import { MobileController } from '/sdk/mobile.js';

// Firing state variables
let isFiring = false;
let fireIntervalId = null;
let lastFireTime = 0;

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

// Power Attack / Charging State
let chargeTimer = null;
let chargeProgress = 0;
let chargeStartTime = 0;
const CHARGE_DURATION = 800; // 800ms for full charge

// Local Settings State
let settings = { playerName: 'Player', sensitivity: 1.0, invertX: false, invertY: false, currentWeapon: 'plasma' };

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
function handleStatusChange(state, gameState, isHead) {
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
        
        // Show/hide start controls based on head status
        const headControls = document.getElementById('lobby-head-controls');
        const waitControls = document.getElementById('lobby-wait-controls');
        if (headControls && waitControls) {
          if (isHead) {
            headControls.classList.remove('hidden');
            waitControls.classList.add('hidden');
          } else {
            headControls.classList.add('hidden');
            waitControls.classList.remove('hidden');
          }
        }
      } else {
        lobbyOverlay.classList.add('hidden');
      }
    }
  } else {
    isConnected = false;
    stopFiring();
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

function updateWeaponSelectorUI() {
  const activeWeapon = settings.currentWeapon || 'plasma';
  const plasmaBtn = document.getElementById('weapon-btn-plasma');
  const laserBtn = document.getElementById('weapon-btn-laser');
  const railgunBtn = document.getElementById('weapon-btn-railgun');
  
  if (plasmaBtn && laserBtn && railgunBtn) {
    plasmaBtn.classList.remove('active');
    laserBtn.classList.remove('active');
    railgunBtn.classList.remove('active');
    
    if (activeWeapon === 'laser') {
      laserBtn.classList.add('active');
    } else if (activeWeapon === 'railgun') {
      railgunBtn.classList.add('active');
    } else {
      plasmaBtn.classList.add('active');
    }
  }
}

function selectWeapon(weaponName) {
  if (settings.currentWeapon === weaponName) return;
  
  stopFiring();
  stopCharging();
  
  settings.currentWeapon = weaponName;
  try {
    localStorage.setItem('motion_shooter_settings', JSON.stringify(settings));
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
  
  updateWeaponSelectorUI();
  
  if (connection && isConnected) {
    connection.sendWeaponChange(weaponName);
  }
}

function startCharging() {
  if (chargeTimer) clearInterval(chargeTimer);
  chargeProgress = 0;
  chargeStartTime = Date.now();
  
  const chargeBar = document.getElementById('charge-bar-container');
  const progressFill = document.getElementById('charge-bar-progress');
  if (chargeBar) chargeBar.classList.remove('hidden');

  chargeTimer = setInterval(() => {
    const elapsed = Date.now() - chargeStartTime;
    chargeProgress = Math.min(1.0, elapsed / CHARGE_DURATION);
    
    if (progressFill) {
      progressFill.style.width = `${chargeProgress * 100}%`;
    }

    if (connection && isConnected) {
      connection.send({
        type: MSG_TYPES.CHARGE_UPDATE,
        payload: { charge: chargeProgress }
      });
    }

    if (chargeProgress >= 1.0) {
      if (navigator.vibrate) {
        navigator.vibrate(40);
      }
    }
  }, 50);
}

function stopCharging() {
  if (chargeTimer) {
    clearInterval(chargeTimer);
    chargeTimer = null;
  }

  const chargeBar = document.getElementById('charge-bar-container');
  if (chargeBar) chargeBar.classList.add('hidden');

  const wasFullyCharged = chargeProgress >= 1.0;
  chargeProgress = 0;

  if (connection && isConnected) {
    connection.send({
      type: MSG_TYPES.CHARGE_UPDATE,
      payload: { charge: 0 }
    });
  }

  return wasFullyCharged;
}

function startFiring(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  
  // Start charging the power attack on press/hold
  startCharging();

  if (isFiring) return;
  const activeWeapon = WEAPONS[settings.currentWeapon || 'plasma'];

  if (activeWeapon.fireMode === 'auto') {
    isFiring = true;
    fireSingleShot();
    
    fireIntervalId = setInterval(() => {
      fireSingleShot();
    }, activeWeapon.fireInterval);
  } else {
    const now = Date.now();
    if (now - lastFireTime >= activeWeapon.fireInterval) {
      fireSingleShot();
      lastFireTime = now;
    }
  }
}

function stopFiring(e) {
  if (e) {
    if (typeof e.preventDefault === 'function') e.preventDefault();
    if (typeof e.stopPropagation === 'function') e.stopPropagation();
  }

  // Stop charging and release heavy attack if fully charged
  const fullyCharged = stopCharging();
  if (fullyCharged && connection && isConnected) {
    connection.send({
      type: MSG_TYPES.SHOOT,
      payload: { isCharged: true }
    });
  }

  isFiring = false;
  if (fireIntervalId) {
    clearInterval(fireIntervalId);
    fireIntervalId = null;
  }
}

function fireSingleShot() {
  if (connection && isConnected) {
    connection.sendShoot();
    
    touchPad.classList.add('firing');
    setTimeout(() => {
      touchPad.classList.remove('firing');
    }, 100);
  }
}

// Attach Touchpad Events (Ensuring Recenter clicks are isolated)
recenterBtn.addEventListener('touchstart', (e) => {
  e.stopPropagation();
  triggerRecenter();
}, { passive: true });

recenterBtn.addEventListener('click', (e) => {
  e.stopPropagation();
});

// Touchpad Drag-to-Aim & Full-Screen Tap-to-Shoot
touchPad.addEventListener('touchstart', (e) => {
  // Prevent firing on system UI interactions
  if (e.target.closest('#recenter-btn') || e.target.closest('#settings-toggle-btn') || e.target.closest('.weapon-btn')) {
    return;
  }
  e.preventDefault(); // Prevents zooming and default tapping behaviors
  
  const touch = e.touches[0];
  startTouch = { x: touch.clientX, y: touch.clientY, time: Date.now() };
  isDragging = false;

  // Start firing immediately
  startFiring();
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
  startTouch = null;
  isDragging = false;
  
  // Stop firing
  stopFiring();
}, { passive: false });

touchPad.addEventListener('touchcancel', (e) => {
  e.preventDefault();
  startTouch = null;
  isDragging = false;
  
  // Stop firing
  stopFiring();
}, { passive: false });

// Mouse fallback for local desktop testing
touchPad.addEventListener('mousedown', (e) => {
  if (e.target.closest('#recenter-btn') || e.target.closest('#settings-toggle-btn') || e.target.closest('.weapon-btn')) {
    return;
  }
  startFiring();
});

touchPad.addEventListener('mouseup', () => {
  stopFiring();
});

touchPad.addEventListener('mouseleave', () => {
  stopFiring();
});

function loadSettings() {
  try {
    const stored = localStorage.getItem('motion_shooter_settings');
    if (stored) {
      settings = { ...settings, ...JSON.parse(stored) };
    }
  } catch (e) {
    console.error('Failed to load settings:', e);
  }

  // Sanitise weapon selection to avoid legacy value crash
  if (!WEAPONS[settings.currentWeapon]) {
    settings.currentWeapon = 'plasma';
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
  updateWeaponSelectorUI();
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

  // Mobile Start Game Button click handler
  const mobileStartBtn = document.getElementById('mobile-start-btn');
  if (mobileStartBtn) {
    const handleStart = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (connection && isConnected) {
        connection.sendStartGame();
      } else {
        console.warn('[MOBILE START] Cannot start: connection is active?', isConnected);
      }
    };
    mobileStartBtn.addEventListener('click', handleStart);
    mobileStartBtn.addEventListener('touchstart', handleStart, { passive: false });
  }

  // Name prompt workflow modal
  const namePromptOverlay = document.getElementById('name-prompt-overlay');
  const promptNameInput = document.getElementById('prompt-name-input');
  const promptConnectBtn = document.getElementById('prompt-connect-btn');

  function showNamePrompt(onSuccess) {
    if (namePromptOverlay && promptNameInput && promptConnectBtn) {
      promptNameInput.value = settings.playerName || 'Player';
      namePromptOverlay.classList.remove('hidden');

      // Clone button to strip existing listeners
      const newConnectBtn = promptConnectBtn.cloneNode(true);
      promptConnectBtn.parentNode.replaceChild(newConnectBtn, promptConnectBtn);

      newConnectBtn.addEventListener('click', () => {
        const enteredName = promptNameInput.value.trim();
        if (enteredName.length > 0) {
          settings.playerName = enteredName;
          try {
            localStorage.setItem('motion_shooter_settings', JSON.stringify(settings));
          } catch (e) {
            console.error('Failed to save settings:', e);
          }
          namePromptOverlay.classList.add('hidden');
          onSuccess();
        } else {
          alert('Please enter a name to join.');
        }
      });
    } else {
      onSuccess();
    }
  }

  if (sessionId && sessionId.trim().length > 0) {
    if (joinOverlay) joinOverlay.classList.add('hidden');
    showNamePrompt(() => {
      checkSensors();
    });
  } else {
    if (joinOverlay) joinOverlay.classList.remove('hidden');
    if (joinSessionBtn && joinCodeInput) {
      joinSessionBtn.addEventListener('click', () => {
        const val = joinCodeInput.value.trim().toUpperCase();
        if (val.length > 0) {
          sessionId = val;
          window.history.replaceState(null, '', `?session=${sessionId}`);
          joinOverlay.classList.add('hidden');
          showNamePrompt(() => {
            checkSensors();
          });
        }
      });
    }
  }

  // Bind Weapon Selector Buttons
  const plasmaBtn = document.getElementById('weapon-btn-plasma');
  const laserBtn = document.getElementById('weapon-btn-laser');
  const railgunBtn = document.getElementById('weapon-btn-railgun');
  if (plasmaBtn) {
    plasmaBtn.addEventListener('click', () => selectWeapon('plasma'));
    plasmaBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      selectWeapon('plasma');
    }, { passive: false });
  }
  if (laserBtn) {
    laserBtn.addEventListener('click', () => selectWeapon('laser'));
    laserBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      selectWeapon('laser');
    }, { passive: false });
  }
  if (railgunBtn) {
    railgunBtn.addEventListener('click', () => selectWeapon('railgun'));
    railgunBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      selectWeapon('railgun');
    }, { passive: false });
  }

  // Bind Shoot Button
  const shootBtn = document.getElementById('shoot-btn');
  if (shootBtn) {
    shootBtn.addEventListener('touchstart', startFiring, { passive: false });
    shootBtn.addEventListener('touchend', stopFiring, { passive: false });
    shootBtn.addEventListener('touchcancel', stopFiring, { passive: false });
    
    shootBtn.addEventListener('mousedown', startFiring);
    shootBtn.addEventListener('mouseup', stopFiring);
    shootBtn.addEventListener('mouseleave', stopFiring);
  }

  // Bind Global safety focus releases
  window.addEventListener('blur', stopFiring);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopFiring();
    }
  });
}

// Start initialization flow
window.addEventListener('DOMContentLoaded', initSession);
