import { MSG_TYPES } from '/shared/constants.js';

/**
 * GameConnection manages the WebSocket lifecycle for the laptop game client.
 * Registers as the main game screen and routes signals to the application loop.
 */
export class GameConnection {
  /**
   * @param {function} onStatusChange Callback triggered when the connection status updates.
   * @param {function} onOrientation Callback for receiving raw device orientation updates.
   * @param {function} onShoot Callback triggered when a shoot command is received.
   * @param {function} onRecenter Callback triggered when a recenter command is received.
   */
  constructor(onStatusChange, onOrientation, onShoot, onRecenter) {
    this.onStatusChange = onStatusChange;
    this.onOrientation = onOrientation;
    this.onShoot = onShoot;
    this.onRecenter = onRecenter;
    this.socket = null;
    this.reconnectTimeout = null;
    this.isPurposelyClosed = false;
  }

  /**
   * Initializes the WebSocket connection.
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
      console.log('Game socket opened. Registering as game client...');
      this.send({ type: MSG_TYPES.REGISTER_GAME });
    };

    this.socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);

        switch (message.type) {
          case MSG_TYPES.STATUS_UPDATE:
            this.onStatusChange(message.state);
            break;
          case MSG_TYPES.ORIENTATION:
            if (message.payload) {
              this.onOrientation(message.payload.alpha, message.payload.beta, message.payload.gamma);
            } else {
              this.onOrientation(message.alpha, message.beta, message.gamma);
            }
            break;
          case MSG_TYPES.SHOOT:
            this.onShoot();
            break;
          case MSG_TYPES.RECENTER:
            this.onRecenter();
            break;
        }
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err);
      }
    };

    this.socket.onclose = () => {
      if (!this.isPurposelyClosed) {
        console.log('Game socket closed. Reconnecting in 2s...');
        this.onStatusChange('DISCONNECTED');
        this.scheduleReconnect();
      }
    };

    this.socket.onerror = (error) => {
      console.error('Game socket error:', error);
    };
  }

  /**
   * Disconnects the socket manually and cancels reconnection schedules.
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
   * Schedules a connection retry.
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
