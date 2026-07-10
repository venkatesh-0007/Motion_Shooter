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
  WEAPON_CHANGE: 'WEAPON_CHANGE',
  CHARGE_UPDATE: 'CHARGE_UPDATE',
  MAP_CHANGE: 'MAP_CHANGE',
  GAME_ENDED: 'GAME_ENDED'
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
 * Central Futuristic Weapon Configurations
 */
export const WEAPONS = {
  plasma: {
    name: 'Plasma Disrupter',
    fireMode: 'semi',
    fireInterval: 400,
    damage: 50,
    color: '#00f2fe'
  },
  laser: {
    name: 'Laser Repeater',
    fireMode: 'auto',
    fireInterval: 120,
    damage: 25,
    color: '#ff007f'
  },
  railgun: {
    name: 'Quantum Railgun',
    fireMode: 'semi',
    fireInterval: 800,
    damage: 100,
    color: '#00ff66'
  }
};
