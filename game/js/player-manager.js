/**
 * PlayerManager manages connected players, their individual settings,
 * orientations, crosshair states, and game statistics on the client side.
 */
export class PlayerManager {
  constructor() {
    this.players = new Map();
    // Slots for player session IDs to guarantee consistent indexing and colors (0: Red, 1: Blue, 2: Green)
    this.playerIndices = [null, null, null];
    this.colors = ['#ff0055', '#0066ff', '#00ff66']; // Premium Red, Blue, Green neon hues
  }

  /**
   * Adds or updates a player in the session.
   * @param {string} sessionId The controller's unique connection ID.
   * @param {string} playerName The display name of the player.
   * @param {number} sensitivity Calibration modifier.
   * @param {boolean} invertX Invert horizontal control.
   * @param {boolean} invertY Invert vertical control.
   */
  addPlayer(sessionId, playerName = 'Player', sensitivity = 1.0, invertX = false, invertY = false) {
    // 1. Assign or find index for color consistency
    let index = this.playerIndices.indexOf(sessionId);
    if (index === -1) {
      // Find the first empty slot
      index = this.playerIndices.indexOf(null);
      if (index === -1) {
        // Fallback if max players exceeded (clamp to 0)
        index = 0;
      }
      this.playerIndices[index] = sessionId;
    }

    const playerColor = this.colors[index] || '#00f2fe';

    if (!this.players.has(sessionId)) {
      const player = {
        sessionId,
        playerName,
        sensitivity,
        invertX,
        invertY,
        connected: true,
        ready: false,
        orientation: { alpha: 0, beta: 0, gamma: 0 },
        lastSeen: Date.now(),
        referenceOrientation: null,
        playerIndex: index,
        score: 0,
        shots: 0,
        hits: 0,
        crosshair: {
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
          targetX: window.innerWidth / 2,
          targetY: window.innerHeight / 2,
          radius: 15,
          shootPulse: 0,
          color: playerColor
        }
      };
      this.players.set(sessionId, player);
      return player;
    } else {
      const player = this.players.get(sessionId);
      player.playerName = playerName;
      player.sensitivity = sensitivity;
      player.invertX = invertX;
      player.invertY = invertY;
      player.connected = true;
      player.lastSeen = Date.now();
      return player;
    }
  }

  /**
   * Marks a player as disconnected and frees up their color index slot.
   */
  removePlayer(sessionId) {
    if (this.players.has(sessionId)) {
      const player = this.players.get(sessionId);
      player.connected = false;
      player.lastSeen = Date.now();

      // Free slot index so another player joining can claim it
      const index = this.playerIndices.indexOf(sessionId);
      if (index !== -1) {
        this.playerIndices[index] = null;
      }
    }
  }

  /**
   * Retrieves a player object by session ID.
   */
  getPlayer(sessionId) {
    return this.players.get(sessionId);
  }

  /**
   * Returns a list of currently connected players.
   */
  getConnectedPlayers() {
    return Array.from(this.players.values()).filter(p => p.connected);
  }

  /**
   * Updates raw orientation input from the mobile client.
   */
  updateOrientation(sessionId, alpha, beta, gamma) {
    let player = this.players.get(sessionId);
    if (!player) {
      player = this.addPlayer(sessionId);
    }
    player.orientation = { alpha, beta, gamma };
    player.lastSeen = Date.now();
    return player;
  }

  /**
   * Live updates player configurations.
   */
  updateSettings(sessionId, settings) {
    const player = this.players.get(sessionId);
    if (player) {
      if (settings.playerName !== undefined) player.playerName = settings.playerName;
      if (settings.sensitivity !== undefined) player.sensitivity = settings.sensitivity;
      if (settings.invertX !== undefined) player.invertX = settings.invertX;
      if (settings.invertY !== undefined) player.invertY = settings.invertY;
      player.lastSeen = Date.now();
    }
  }

  /**
   * Synchronises player stats with server updates.
   */
  updateStats(sessionId, score, shots, hits) {
    const player = this.players.get(sessionId);
    if (player) {
      player.score = score;
      player.shots = shots;
      player.hits = hits;
      player.lastSeen = Date.now();
    }
  }

  /**
   * Resets all player scores, shots, and hits locally.
   */
  resetAllPlayerStats() {
    this.players.forEach(player => {
      player.score = 0;
      player.shots = 0;
      player.hits = 0;
      player.crosshair.shootPulse = 0;
    });
  }

  /**
   * Gets the active player (first connected player in insertion order).
   */
  getActivePlayer() {
    for (const player of this.players.values()) {
      if (player.connected) {
        return player;
      }
    }
    return null;
  }

  /**
   * Gets the active player's session ID.
   */
  getActivePlayerId() {
    const active = this.getActivePlayer();
    return active ? active.sessionId : null;
  }
}
