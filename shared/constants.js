/**
 * Shared message types for WebSocket communication
 */
export const MSG_TYPES = {
  // Client registration
  REGISTER_GAME: 'REGISTER_GAME',
  REGISTER_CONTROLLER: 'REGISTER_CONTROLLER',

  // Connection status broadcast
  STATUS_UPDATE: 'STATUS_UPDATE',

  // Gameplay actions
  ORIENTATION: 'ORIENTATION',
  SHOOT: 'SHOOT',
  RECENTER: 'RECENTER',

  // Settings and multiplayer events
  SETTINGS_UPDATE: 'SETTINGS_UPDATE',
  PLAYER_CONNECTED: 'PLAYER_CONNECTED',
  PLAYER_DISCONNECTED: 'PLAYER_DISCONNECTED',
  START_GAME: 'START_GAME',
  PLAYER_HIT: 'PLAYER_HIT',
  PLAYER_STATS: 'PLAYER_STATS',
  RESET_STATS: 'RESET_STATS',
  RETURN_TO_LOBBY: 'RETURN_TO_LOBBY',
  WEAPON_CHANGE: 'WEAPON_CHANGE'
};

/**
 * Connection states for clients
 */
export const CONNECTION_STATES = {
  WAITING: 'WAITING',
  CONNECTED: 'CONNECTED',
  DISCONNECTED: 'DISCONNECTED'
};

/**
 * Central Weapon Configurations
 */
export const WEAPONS = {
  pistol: {
    name: 'Pistol',
    fireMode: 'semi',
    fireInterval: 350, // ms cooldown
    damage: 50,
    spread: 0,
    range: 100
  },
  smg: {
    name: 'SMG',
    fireMode: 'auto',
    fireInterval: 120, // ms between shots
    damage: 20,
    spread: 0.05, // Small spread for 3D compatibility
    range: 60
  }
};
