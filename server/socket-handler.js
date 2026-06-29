import { MSG_TYPES, CONNECTION_STATES } from '../shared/constants.js';

const sessions = {};

function getSession(id) {
  if (!id) return null;
  if (!sessions[id]) {
    sessions[id] = { gameSocket: null, controllers: new Set() };
  }
  return sessions[id];
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
            sendStatusUpdates(session);
          }
          break;

        case MSG_TYPES.REGISTER_CONTROLLER:
          if (message.sessionId) {
            console.log(`Controller Connected to session ${message.sessionId}`);
            const session = getSession(message.sessionId);
            session.controllers.add(ws);
            registeredAs = 'controller';
            ws.sessionId = message.sessionId;
            sendStatusUpdates(session);
          }
          break;

        case MSG_TYPES.ORIENTATION:
          // Forward orientation events directly to the laptop game client
          if (ws.sessionId && sessions[ws.sessionId]) {
            const gameSocket = sessions[ws.sessionId].gameSocket;
            if (gameSocket && gameSocket.readyState === 1 /* OPEN */) {
              gameSocket.send(JSON.stringify({
                type: MSG_TYPES.ORIENTATION,
                payload: message.payload
              }));
            }
          }
          break;

        case MSG_TYPES.SHOOT:
          // Forward shoot events to the laptop game client
          if (ws.sessionId && sessions[ws.sessionId]) {
            const gameSocket = sessions[ws.sessionId].gameSocket;
            if (gameSocket && gameSocket.readyState === 1 /* OPEN */) {
              gameSocket.send(JSON.stringify({ type: MSG_TYPES.SHOOT }));
            }
          }
          break;

        case MSG_TYPES.RECENTER:
          // Forward recenter request to the laptop game client
          if (ws.sessionId && sessions[ws.sessionId]) {
            const gameSocket = sessions[ws.sessionId].gameSocket;
            if (gameSocket && gameSocket.readyState === 1 /* OPEN */) {
              gameSocket.send(JSON.stringify({ type: MSG_TYPES.RECENTER }));
            }
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
    session.gameSocket.send(JSON.stringify({ type: MSG_TYPES.STATUS_UPDATE, state }));
  }

  session.controllers.forEach(controller => {
    if (controller.readyState === 1 /* OPEN */) {
      controller.send(JSON.stringify({ type: MSG_TYPES.STATUS_UPDATE, state }));
    }
  });
}
