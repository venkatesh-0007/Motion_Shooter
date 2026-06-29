import { MSG_TYPES, CONNECTION_STATES } from '../shared/constants.js';

let gameSocket = null;
let controllerSocket = null;
let orientationPacketCount = 0;
let packetsForwarded = 0;

/**
 * Handles incoming WebSocket connection messages and event routing.
 * Manages game-to-controller pairing and ensures statuses are synchronised.
 * @param {WebSocket} ws The connected WebSocket instance.
 */
export function handleSocketConnection(ws) {
  let registeredAs = null;

  ws.on('message', (messageText) => {
    try {
      const message = JSON.parse(messageText);

      switch (message.type) {
        case MSG_TYPES.REGISTER_GAME:
          console.log('Game client registered');
          if (gameSocket && gameSocket !== ws) {
            gameSocket.close();
          }
          gameSocket = ws;
          registeredAs = 'game';
          sendStatusUpdates();
          break;

        case MSG_TYPES.REGISTER_CONTROLLER:
          console.log('Controller client registered');
          if (controllerSocket && controllerSocket !== ws) {
            controllerSocket.close();
          }
          controllerSocket = ws;
          registeredAs = 'controller';
          sendStatusUpdates();
          break;

        case MSG_TYPES.ORIENTATION:
          // Forward orientation events directly to the laptop game client
          orientationPacketCount++;
          let forwarded = false;
          
          if (gameSocket && gameSocket.readyState === 1 /* OPEN */) {
            gameSocket.send(JSON.stringify({
              type: MSG_TYPES.ORIENTATION,
              payload: message.payload
            }));
            packetsForwarded++;
            forwarded = true;
          }
          
          if (orientationPacketCount % 60 === 0) {
            console.log(`Packets Received: ${orientationPacketCount}`);
            console.log(`Packets Forwarded: ${packetsForwarded}`);
          }
          break;

        case MSG_TYPES.SHOOT:
          console.log('[SERVER SHOOT] Received SHOOT trigger from controller, forwarding to game');
          // Forward shoot events to the laptop game client
          if (gameSocket && gameSocket.readyState === 1 /* OPEN */) {
            gameSocket.send(JSON.stringify({ type: MSG_TYPES.SHOOT }));
          }
          break;

        case MSG_TYPES.RECENTER:
          console.log('[SERVER RECENTER] Received RECENTER trigger from controller, forwarding to game');
          // Forward recenter request to the laptop game client
          if (gameSocket && gameSocket.readyState === 1 /* OPEN */) {
            gameSocket.send(JSON.stringify({ type: MSG_TYPES.RECENTER }));
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
    if (registeredAs === 'game') {
      console.log('Game client disconnected');
      if (gameSocket === ws) {
        gameSocket = null;
      }
      sendStatusUpdates();
    } else if (registeredAs === 'controller') {
      console.log('Controller client disconnected');
      if (controllerSocket === ws) {
        controllerSocket = null;
      }
      sendStatusUpdates();
    }
  });

  ws.on('error', (err) => {
    console.error('WebSocket connection error:', err);
  });
}

/**
 * Sends connection state updates to the clients based on their pairing status.
 */
function sendStatusUpdates() {
  const isGameConnected = gameSocket && gameSocket.readyState === 1 /* OPEN */;
  const isControllerConnected = controllerSocket && controllerSocket.readyState === 1 /* OPEN */;

  if (isGameConnected && isControllerConnected) {
    gameSocket.send(JSON.stringify({ type: MSG_TYPES.STATUS_UPDATE, state: CONNECTION_STATES.CONNECTED }));
    controllerSocket.send(JSON.stringify({ type: MSG_TYPES.STATUS_UPDATE, state: CONNECTION_STATES.CONNECTED }));
  } else {
    if (isGameConnected) {
      gameSocket.send(JSON.stringify({ type: MSG_TYPES.STATUS_UPDATE, state: CONNECTION_STATES.WAITING }));
    }
    if (isControllerConnected) {
      controllerSocket.send(JSON.stringify({ type: MSG_TYPES.STATUS_UPDATE, state: CONNECTION_STATES.WAITING }));
    }
  }
}
