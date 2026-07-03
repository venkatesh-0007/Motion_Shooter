import { MSG_TYPES, CONNECTION_STATES } from '../shared/constants.js';

const sessions = {};

function getSession(id) {
  if (!id) return null;
  if (!sessions[id]) {
    sessions[id] = { gameSocket: null, controllers: new Set(), state: 'lobby' };
  }
  return sessions[id];
}

/**
 * Notifies the game client about a controller joining or leaving, including its settings and stats.
 */
function notifyGameOfPlayerChange(session, controllerSocket, status) {
  const gameSocket = session.gameSocket;
  if (gameSocket && gameSocket.readyState === 1 /* OPEN */) {
    const settings = controllerSocket.settings || { playerName: 'Player', sensitivity: 1.0, invertX: false, invertY: false };
    const stats = controllerSocket.playerStats || { score: 0, shots: 0, hits: 0 };
    gameSocket.send(JSON.stringify({
      type: status === 'connected' ? MSG_TYPES.PLAYER_CONNECTED : MSG_TYPES.PLAYER_DISCONNECTED,
      playerId: controllerSocket.controllerId,
      payload: {
        sessionId: controllerSocket.controllerId,
        playerName: settings.playerName || 'Player',
        sensitivity: settings.sensitivity !== undefined ? settings.sensitivity : 1.0,
        invertX: settings.invertX || false,
        invertY: settings.invertY || false,
        connected: status === 'connected',
        ready: false,
        orientation: { alpha: 0, beta: 0, gamma: 0 },
        lastSeen: Date.now(),
        score: stats.score,
        shots: stats.shots,
        hits: stats.hits
      }
    }));
  }
}

/**
 * Handles incoming WebSocket connection messages and event routing.
 * Manages game-to-controller pairing and ensures statuses are synchronised per session.
 * @param {WebSocket} ws The connected WebSocket instance.
 */
export function handleSocketConnection(ws) {
  let registeredAs = null;

  ws.on('message', (messageText) => {
    try {
      const message = JSON.parse(messageText);

      switch (message.type) {
        case MSG_TYPES.REGISTER_GAME:
          if (message.sessionId) {
            console.log(`Game Connected to session ${message.sessionId}`);
            const session = getSession(message.sessionId);
            if (session.gameSocket && session.gameSocket !== ws) {
              session.gameSocket.close();
            }
            session.gameSocket = ws;
            registeredAs = 'game';
            ws.sessionId = message.sessionId;
            
            // Reset state to lobby
            session.state = 'lobby';
            
            sendStatusUpdates(session);
            
            // Sync all existing controllers to the game client
            session.controllers.forEach(controller => {
              notifyGameOfPlayerChange(session, controller, 'connected');
            });
          }
          break;

        case MSG_TYPES.REGISTER_CONTROLLER:
          if (message.sessionId) {
            console.log(`Controller Connected to session ${message.sessionId}`);
            const session = getSession(message.sessionId);
            
            ws.controllerId = message.controllerId || ('P-' + Math.random().toString(36).substring(2, 8).toUpperCase());
            ws.settings = message.settings || { playerName: 'Player', sensitivity: 1.0, invertX: false, invertY: false };
            ws.playerStats = ws.playerStats || { score: 0, shots: 0, hits: 0 };
            
            session.controllers.add(ws);
            registeredAs = 'controller';
            ws.sessionId = message.sessionId;
            sendStatusUpdates(session);
            
            // Notify game client of player connection
            notifyGameOfPlayerChange(session, ws, 'connected');
          }
          break;

        case MSG_TYPES.ORIENTATION:
          // Forward orientation events directly to the laptop game client
          if (ws.sessionId && sessions[ws.sessionId]) {
            const gameSocket = sessions[ws.sessionId].gameSocket;
            if (gameSocket && gameSocket.readyState === 1 /* OPEN */) {
              gameSocket.send(JSON.stringify({
                type: MSG_TYPES.ORIENTATION,
                playerId: ws.controllerId,
                payload: message.payload
              }));
            }
          }
          break;

        case MSG_TYPES.SHOOT:
          // Forward shoot events to the laptop game client
          if (ws.sessionId && sessions[ws.sessionId]) {
            if (ws.playerStats) {
              ws.playerStats.shots = (ws.playerStats.shots || 0) + 1;
            }
            const gameSocket = sessions[ws.sessionId].gameSocket;
            if (gameSocket && gameSocket.readyState === 1 /* OPEN */) {
              gameSocket.send(JSON.stringify({ 
                type: MSG_TYPES.SHOOT,
                playerId: ws.controllerId
              }));
            }
          }
          break;

        case MSG_TYPES.RECENTER:
          // Forward recenter request to the laptop game client
          if (ws.sessionId && sessions[ws.sessionId]) {
            const gameSocket = sessions[ws.sessionId].gameSocket;
            if (gameSocket && gameSocket.readyState === 1 /* OPEN */) {
              gameSocket.send(JSON.stringify({ 
                type: MSG_TYPES.RECENTER,
                playerId: ws.controllerId
              }));
            }
          }
          break;

        case MSG_TYPES.SETTINGS_UPDATE:
          if (ws.sessionId && sessions[ws.sessionId]) {
            ws.settings = message.payload.settings;
            // Forward settings update to game client
            const gameSocket = sessions[ws.sessionId].gameSocket;
            if (gameSocket && gameSocket.readyState === 1 /* OPEN */) {
              gameSocket.send(JSON.stringify({
                type: MSG_TYPES.SETTINGS_UPDATE,
                playerId: ws.controllerId,
                payload: {
                  settings: ws.settings
                }
              }));
            }
          }
          break;

        case MSG_TYPES.START_GAME:
          if (ws.sessionId && sessions[ws.sessionId]) {
            const session = sessions[ws.sessionId];
            session.state = 'playing';
            
            // Forward START_GAME to all controllers
            session.controllers.forEach(controller => {
              if (controller.readyState === 1 /* OPEN */) {
                controller.send(JSON.stringify({ type: MSG_TYPES.START_GAME }));
              }
            });
          }
          break;

        case MSG_TYPES.PLAYER_HIT:
          if (ws.sessionId && sessions[ws.sessionId]) {
            const session = sessions[ws.sessionId];
            const targetPlayerId = message.playerId;
            // Find target controller socket
            let targetSocket = null;
            session.controllers.forEach(controller => {
              if (controller.controllerId === targetPlayerId) {
                targetSocket = controller;
              }
            });
            
            if (targetSocket) {
              targetSocket.playerStats.hits = (targetSocket.playerStats.hits || 0) + 1;
              targetSocket.playerStats.score = (targetSocket.playerStats.score || 0) + 100;
              
              // Broadcast updated stats to game client
              if (session.gameSocket && session.gameSocket.readyState === 1 /* OPEN */) {
                session.gameSocket.send(JSON.stringify({
                  type: MSG_TYPES.PLAYER_STATS,
                  playerId: targetPlayerId,
                  payload: {
                    score: targetSocket.playerStats.score,
                    shots: targetSocket.playerStats.shots,
                    hits: targetSocket.playerStats.hits
                  }
                }));
              }
            }
          }
          break;

        case MSG_TYPES.RESET_STATS:
          if (ws.sessionId && sessions[ws.sessionId]) {
            const session = sessions[ws.sessionId];
            session.controllers.forEach(controller => {
              controller.playerStats = { score: 0, shots: 0, hits: 0 };
              if (session.gameSocket && session.gameSocket.readyState === 1 /* OPEN */) {
                session.gameSocket.send(JSON.stringify({
                  type: MSG_TYPES.PLAYER_STATS,
                  playerId: controller.controllerId,
                  payload: controller.playerStats
                }));
              }
            });
          }
          break;

        case MSG_TYPES.RETURN_TO_LOBBY:
          if (ws.sessionId && sessions[ws.sessionId]) {
            const session = sessions[ws.sessionId];
            session.state = 'lobby';
            
            // Reset all player stats
            session.controllers.forEach(controller => {
              controller.playerStats = { score: 0, shots: 0, hits: 0 };
              if (session.gameSocket && session.gameSocket.readyState === 1 /* OPEN */) {
                session.gameSocket.send(JSON.stringify({
                  type: MSG_TYPES.PLAYER_STATS,
                  playerId: controller.controllerId,
                  payload: controller.playerStats
                }));
              }
            });
            
            // Broadcast STATUS_UPDATE back to lobby state
            sendStatusUpdates(session);
          }
          break;

        default:
          console.warn('Unknown WebSocket message type:', message.type);
      }
    } catch (err) {
      console.error('Error handling WebSocket message:', err);
    }
  });

  ws.on('close', () => {
    if (ws.sessionId && sessions[ws.sessionId]) {
      const session = sessions[ws.sessionId];
      if (registeredAs === 'game') {
        console.log(`Game Disconnected from session ${ws.sessionId}`);
        if (session.gameSocket === ws) {
          session.gameSocket = null;
        }
      } else if (registeredAs === 'controller') {
        console.log(`Controller Disconnected from session ${ws.sessionId}`);
        session.controllers.delete(ws);
        
        // Notify game client of player disconnection
        notifyGameOfPlayerChange(session, ws, 'disconnected');
      }
      sendStatusUpdates(session);

      // Cleanup empty sessions
      if (!session.gameSocket && session.controllers.size === 0) {
        delete sessions[ws.sessionId];
      }
    }
  });

  ws.on('error', (err) => {
    console.error('WebSocket connection error:', err);
  });
}

/**
 * Sends connection state updates to the clients based on their pairing status.
 * @param {object} session The session object containing gameSocket and controllers.
 */
function sendStatusUpdates(session) {
  if (!session) return;
  
  const isGameConnected = session.gameSocket && session.gameSocket.readyState === 1 /* OPEN */;
  const isControllerConnected = session.controllers.size > 0;

  const state = (isGameConnected && isControllerConnected) ? CONNECTION_STATES.CONNECTED : CONNECTION_STATES.WAITING;

  if (isGameConnected) {
    session.gameSocket.send(JSON.stringify({ 
      type: MSG_TYPES.STATUS_UPDATE, 
      state,
      gameState: session.state
    }));
  }

  session.controllers.forEach(controller => {
    if (controller.readyState === 1 /* OPEN */) {
      controller.send(JSON.stringify({ 
        type: MSG_TYPES.STATUS_UPDATE, 
        state,
        gameState: session.state
      }));
    }
  });
}
