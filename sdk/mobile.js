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
      this.socket.send(JSON.stringify({ type: MSG_TYPES.REGISTER_CONTROLLER, sessionId: this.sessionId }));
    };

    this.socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === MSG_TYPES.STATUS_UPDATE && this.onStatusChange) {
          this.onStatusChange(message.state);
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
}
