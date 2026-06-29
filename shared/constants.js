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
  RECENTER: 'RECENTER'
};

/**
 * Connection states for clients
 */
export const CONNECTION_STATES = {
  WAITING: 'WAITING',
  CONNECTED: 'CONNECTED',
  DISCONNECTED: 'DISCONNECTED'
};
