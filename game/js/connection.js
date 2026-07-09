import { MSG_TYPES } from '/shared/constants.js';
import { WS_URL } from '/shared/config.js';

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
  constructor(sessionId, onStatusChange, onOrientation, onShoot, onRecenter) {
    this.sessionId = sessionId;
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
    if (this.socket) {
      try {
        this.socket.close();
      } catch (e) {}
    }

    this.socket = new WebSocket(WS_URL);

    this.socket.onopen = () => {
      this.send({ type: MSG_TYPES.REGISTER_GAME, sessionId: this.sessionId });
    };

    this.socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);

        switch (message.type) {
          case MSG_TYPES.STATUS_UPDATE:
            this.onStatusChange(message.state, message.gameState);
            break;
          case MSG_TYPES.ORIENTATION: {
            const pId = message.playerId || 'default';
            if (message.payload) {
              this.onOrientation(pId, message.payload.alpha, message.payload.beta, message.payload.gamma);
            } else {
              this.onOrientation(pId, message.alpha, message.beta, message.gamma);
            }
            break;
          }
          case MSG_TYPES.SHOOT: {
            const pId = message.playerId || 'default';
            this.onShoot(pId);
            break;
          }
          case MSG_TYPES.RECENTER: {
            const pId = message.playerId || 'default';
            this.onRecenter(pId);
            break;
          }
          case MSG_TYPES.START_GAME:
            if (this.onStartGame) {
              this.onStartGame();
            }
            break;
          case MSG_TYPES.WEAPON_CHANGE:
            if (this.onPlayerWeaponChanged) {
              this.onPlayerWeaponChanged(message.playerId, message.payload.weapon);
            }
            break;
          case MSG_TYPES.PLAYER_CONNECTED:
            if (this.onPlayerConnected) {
              this.onPlayerConnected(message.payload);
            }
            break;
          case MSG_TYPES.PLAYER_DISCONNECTED:
            if (this.onPlayerDisconnected) {
              this.onPlayerDisconnected(message.playerId);
            }
            break;
          case MSG_TYPES.SETTINGS_UPDATE:
            if (this.onPlayerSettingsUpdated) {
              this.onPlayerSettingsUpdated(message.playerId, message.payload.settings);
            }
            break;
          case MSG_TYPES.PLAYER_STATS:
            if (this.onPlayerStatsUpdated) {
              this.onPlayerStatsUpdated(message.playerId, message.payload);
            }
            break;
        }
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err);
      }
    };

    this.socket.onclose = () => {
      if (!this.isPurposelyClosed) {

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

  sendStartGame() {
    this.send({ type: MSG_TYPES.START_GAME });
  }

  sendPlayerHit(playerId, hitType = 'body') {
    this.send({ type: MSG_TYPES.PLAYER_HIT, playerId, hitType });
  }

  sendResetStats() {
    this.send({ type: MSG_TYPES.RESET_STATS });
  }

  sendReturnToLobby() {
    this.send({ type: MSG_TYPES.RETURN_TO_LOBBY });
  }
}
