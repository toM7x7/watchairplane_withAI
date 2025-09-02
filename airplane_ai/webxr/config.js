const host = (typeof location !== 'undefined' && location.hostname) ? location.hostname : 'localhost';
const proto = (typeof location !== 'undefined' && location.protocol === 'https:') ? 'https' : 'http';
export const CONFIG = {
  FLIGHT_ENDPOINT: `${proto}://${host}:8080`, // or Cloud Run URL
  TTS_ENDPOINT: `${proto}://${host}:8081`     // or Cloud Run URL
};

