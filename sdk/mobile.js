import { MSG_TYPES } from '/shared/constants.js';
import { WS_URL } from '/shared/config.js';

export class MobileController {
  constructor(sessionId, onStatusChange) {
    this.sessionId = sessionId;
    this.onStatusChange = onStatusChange;
    this.socket = null;
    this.reconnectTimeout = null;
    this.isPurposelyClosed = false;
  }

  connect() {
    this.isPurposelyClosed = false;
    if (this.socket) {
      try { this.socket.close(); } catch (e) {}
    }

    this.socket = new WebSocket(WS_URL);

    this.socket.onopen = () => {
      let controllerId = localStorage.getItem('motion_shooter_controller_id');
      if (!controllerId) {
        controllerId = 'P-' + Math.random().toString(36).substring(2, 8).toUpperCase();
        localStorage.setItem('motion_shooter_controller_id', controllerId);
      }
      this.controllerId = controllerId;

      // Load settings
      let settings = { playerName: 'Player', sensitivity: 1.0, invertX: false, invertY: false, currentWeapon: 'plasma' };
      try {
        const stored = localStorage.getItem('motion_shooter_settings');
        if (stored) {
          settings = { ...settings, ...JSON.parse(stored) };
        }
      } catch (e) {
        console.error('Failed to load settings:', e);
      }

      // Sanitise legacy weapons to prevent crashing
      if (settings.currentWeapon === 'pistol' || settings.currentWeapon === 'smg') {
        settings.currentWeapon = 'plasma';
      }

      this.socket.send(JSON.stringify({ 
        type: MSG_TYPES.REGISTER_CONTROLLER, 
        sessionId: this.sessionId,
        controllerId: this.controllerId,
        settings: settings
      }));
    };

    this.socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === MSG_TYPES.STATUS_UPDATE && this.onStatusChange) {
          this.onStatusChange(message.state, message.gameState, message.isHead);
        } else if (message.type === MSG_TYPES.START_GAME && this.onGameStart) {
          this.onGameStart();
        }
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err);
      }
    };

    this.socket.onclose = () => {
      if (!this.isPurposelyClosed) {
        if (this.onStatusChange) this.onStatusChange('DISCONNECTED');
        this.scheduleReconnect();
      }
    };

    this.socket.onerror = (error) => {
      console.error('Controller socket error:', error);
    };
  }

  disconnect() {
    this.isPurposelyClosed = true;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.socket) {
      this.socket.close();
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    this.reconnectTimeout = setTimeout(() => {
      this.connect();
    }, 2000);
  }

  sendOrientation(alpha, beta, gamma) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({
        type: MSG_TYPES.ORIENTATION,
        payload: { alpha, beta, gamma }
      }));
    }
  }

  sendShoot() {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: MSG_TYPES.SHOOT }));
    }
  }

  recenter() {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: MSG_TYPES.RECENTER }));
    }
  }

  sendSettings(settings) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({
        type: MSG_TYPES.SETTINGS_UPDATE,
        payload: { settings }
      }));
    }
  }

  sendStartGame() {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: MSG_TYPES.START_GAME }));
    }
  }

  sendWeaponChange(weapon) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({
        type: MSG_TYPES.WEAPON_CHANGE,
        weapon
      }));
    }
  }

  send(data) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(data));
    }
  }
}

