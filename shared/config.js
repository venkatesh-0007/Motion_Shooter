const isBrowser = typeof window !== 'undefined';

export const BACKEND_URL = isBrowser 
  ? window.location.origin
  : 'http://localhost:3000';

export const WS_URL = isBrowser 
  ? (window.location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + window.location.host
  : 'ws://localhost:3000';
