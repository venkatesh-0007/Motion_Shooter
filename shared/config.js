const isBrowser = typeof window !== 'undefined';
const env = isBrowser ? {} : process.env;

export const IS_PRODUCTION = isBrowser 
  ? (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1')
  : env.NODE_ENV === 'production';

export const BACKEND_URL = IS_PRODUCTION 
  ? (isBrowser ? window.location.origin : (env.BACKEND_URL || ''))
  : 'http://localhost:3000';

export const WS_URL = IS_PRODUCTION 
  ? (isBrowser ? (window.location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + window.location.host : (env.WS_URL || ''))
  : 'ws://localhost:3000';
