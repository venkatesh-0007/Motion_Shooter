import { MSG_TYPES } from '/shared/constants.js';

/**
 * ControllerConnection wraps the WebSocket layer for the mobile client.
 * Handles automatic reconnect logic and registration with the game server.
 */
export class ControllerConnection {
  /**
   * @param {function} onStatusChange Callback triggered when the connection status updates.
   */
  constructor(onStatusChange) {
    this.onStatusChange = onStatusChange;
    this.socket = null;
    this.reconnectTimeout = null;
    this.isPurposelyClosed = false;
  }

  /**
   * Initializes the WebSocket connection using current window location details.
   */
  connect() {
    this.isPurposelyClosed = false;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}`;

    if (this.socket) {
      try {
        this.socket.close();
      } catch (e) {}
    }

    this.socket = new WebSocket(wsUrl);

    this.socket.onopen = () => {
      console.log('Controller socket opened. Sending registration...');
      this.send({ type: MSG_TYPES.REGISTER_CONTROLLER });
    };

    this.socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === MSG_TYPES.STATUS_UPDATE) {
          this.onStatusChange(message.state);
        }
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err);
      }
    };

    this.socket.onclose = () => {
      if (!this.isPurposelyClosed) {
        console.log('Controller socket closed. Reconnecting in 2s...');
        this.onStatusChange('DISCONNECTED');
        this.scheduleReconnect();
      }
    };

    this.socket.onerror = (error) => {
      console.error('Controller socket error:', error);
    };
  }

  /**
   * Disconnects the socket manually and stops reconnection attempts.
   */
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

  /**
   * Schedules a connection retry attempt.
   */
  scheduleReconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    this.reconnectTimeout = setTimeout(() => {
      this.connect();
    }, 2000);
  }

  /**
   * Encodes and sends data if the socket is open.
   * @param {object} data Payload to send.
   */
  send(data) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(data));
    }
  }
}
