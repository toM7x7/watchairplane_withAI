/*
  Flight Proxy (Dev)
  - Minimal Express server exposing /flights with mock data
  - CORS is allowed only in non-production environments
*/

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const app = express();
app.use(express.json({ limit: '1mb' }));
const PORT = process.env.PORT || 8000;

const isProd = process.env.NODE_ENV === 'production';
const provider = (process.env.FLIGHT_PROVIDER || '').toLowerCase();
const OPENSKY_USER = process.env.OPENSKY_USER;
const OPENSKY_PASS = process.env.OPENSKY_PASS;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-pro';
// Aivis Cloud TTS (optional)
const AIVIS_BASE_URL = (process.env.AIVIS_BASE_URL || process.env.AIVIS_URL || '').trim();
const AIVIS_API_KEY = (process.env.AIVIS_API_KEY || '').trim();
const AIVIS_MODEL_UUID = (process.env.AIVIS_MODEL_UUID || process.env.AIVIS_VOICE || '').trim();
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 5000);
if (!isProd) {
  app.use(cors());
}

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/', (_req, res) => {
  const body = `<!doctype html><html><meta charset="utf-8"><title>flight-proxy</title><body style="font-family:system-ui,sans-serif;line-height:1.6;padding:16px;">
  <h1>flight-proxy</h1>
  <p>provider: <b>${provider || 'mock'}</b> (set FLIGHT_PROVIDER=opensky)</p>
  <ul>
    <li><a href="/health">/health</a></li>
    <li><a href="/flights?lat=35.68&lon=139.76&radius=2">/flights?lat=35.68&lon=139.76&radius=2</a></li>
  </ul>
  <p>環境変数: OPENSKY_USER / OPENSKY_PASS（任意）</p>
  </body></html>`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(body);
});

function getJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const m = url.startsWith('https:') ? https : http;
    const req = m.request(url, { method: 'GET', headers }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        try {
          resolve(JSON.parse(buf));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function fetchOpenSky(lat, lon, radiusKm = 100) {
  const delta = Math.max(1, Math.min(4, radiusKm)) / 111; // deg approx, clamp
  const lamin = (lat - delta).toFixed(4);
  const lamax = (lat + delta).toFixed(4);
  const lomin = (lon - delta).toFixed(4);
  const lomax = (lon + delta).toFixed(4);
  const url = `https://opensky-network.org/api/states/all?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`;

  const headers = {};
  if (OPENSKY_USER && OPENSKY_PASS) {
    const b64 = Buffer.from(`${OPENSKY_USER}:${OPENSKY_PASS}`).toString('base64');
    headers.Authorization = `Basic ${b64}`;
  }
  const data = await getJson(url, headers);
  const flights = (data.states || []).map((s) => {
    // OpenSky indices:
    // 0: icao24, 1: callsign, 5: lon, 6: lat, 7: baro_altitude, 9: velocity (m/s), 10: heading (deg), 13: geo_altitude
    const lat = s[6];
    const lon = s[5];
    const alt = s[13] ?? s[7] ?? 0;
    const speed = s[9] ?? 0;
    const heading = s[10] ?? 0;
    return {
      id: s[0],
      callsign: (s[1] || '').trim(),
      lat, lon, alt, speed, heading,
    };
  }).filter(f => Number.isFinite(f.lat) && Number.isFinite(f.lon));
  return { source: 'opensky', generatedAt: new Date().toISOString(), flights };
}

async function loadFlightsFromMock() {
  const file = path.join(__dirname, '..', 'data', 'sample_flights.json');
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

app.get('/flights', async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat || '35.68');
    const lon = parseFloat(req.query.lon || '139.76');
    const radius = parseFloat(req.query.radius || '2'); // km
    const key = `${provider}|${lat.toFixed(3)},${lon.toFixed(3)}|${radius}`;
    const now = Date.now();
    if (!app._cache) app._cache = new Map();
    const cached = app._cache.get(key);
    if (cached && (now - cached.t) < CACHE_TTL_MS) {
      return res.json(cached.data);
    }

    let json;
    if (provider === 'opensky') {
      json = await fetchOpenSky(lat, lon, radius);
    } else {
      json = await loadFlightsFromMock();
    }
    app._cache.set(key, { t: now, data: json });
    res.json(json);
  } catch (err) {
    console.error('Failed to load flight data:', err);
    try {
      const fallback = await loadFlightsFromMock();
      res.json(fallback);
    } catch (e2) {
      res.status(500).json({ error: 'Failed to load flight data' });
    }
  }
});

app.get('/flights/stream', async (req, res) => {
  const lat = parseFloat(req.query.lat || '35.68');
  const lon = parseFloat(req.query.lon || '139.76');
  const radius = parseFloat(req.query.radius || '2');
  const intervalMs = Math.max(1000, Math.min(15000, parseInt(req.query.interval || '3000', 10) || 3000));

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders && res.flushHeaders();

  let closed = false;
  req.on('close', () => { closed = true; clearInterval(timer); });

  async function sendOnce() {
    try {
      let json;
      if (provider === 'opensky') json = await fetchOpenSky(lat, lon, radius);
      else json = await loadFlightsFromMock();
      res.write(`data: ${JSON.stringify(json)}\n\n`);
    } catch (e) {
      res.write(`event: error\n`);
      res.write(`data: {"error":"fetch_failed"}\n\n`);
    }
  }

  await sendOnce();
  const timer = setInterval(() => { if (!closed) sendOnce(); }, intervalMs);
});

function postBinaryStream({ url, headers = {}, body }, onResponse) {
  const u = new URL(url);
  const data = Buffer.from(JSON.stringify(body));
  const opts = {
    method: 'POST',
    hostname: u.hostname,
    path: u.pathname + (u.search || ''),
    port: u.protocol === 'https:' ? 443 : 80,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': data.length,
      ...headers,
    },
  };
  const m = u.protocol === 'https:' ? https : http;
  const req = m.request(opts, (resp) => onResponse(null, resp));
  req.on('error', (e) => onResponse(e));
  req.write(data);
  req.end();
}

// TTS proxy to Aivis Cloud: returns audio/mpeg
app.post('/speak', async (req, res) => {
  try {
    const text = String(req.body?.text || '').slice(0, 5000);
    if (!text) return res.status(400).json({ error: 'text required' });
    if (!AIVIS_BASE_URL || !AIVIS_API_KEY || !AIVIS_MODEL_UUID) {
      // Fallback stub
      return res.json({ provider: 'stub', text });
    }
    const base = AIVIS_BASE_URL.replace(/\/$/, '');
    const url = `${base}/v1/tts/synthesize`;
    postBinaryStream({
      url,
      headers: { Authorization: `Bearer ${AIVIS_API_KEY}` },
      body: {
        model_uuid: AIVIS_MODEL_UUID,
        text,
        use_ssml: true,
        output_format: 'mp3',
        leading_silence_seconds: 0.0,
      },
    }, (err, upstream) => {
      if (err) {
        console.error('aivis tts error:', err);
        return res.status(502).json({ error: 'tts_upstream' });
      }
      if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
        let buf = '';
        upstream.on('data', (c) => (buf += c));
        upstream.on('end', () => {
          res.status(502).json({ error: 'aivis_status', status: upstream.statusCode, body: buf.slice(0, 400) });
        });
        return;
      }
      res.setHeader('Content-Type', 'audio/mpeg');
      upstream.pipe(res);
    });
  } catch (e) {
    console.error('speak error:', e);
    res.status(500).json({ error: 'speak_failed' });
  }
});

// Chat v2: supports system + history + flight + flight_context
app.post('/chat2', async (req, res) => {
  const apiKey = GEMINI_API_KEY;
  const input = (req.body && String(req.body.input || '').slice(0, 4000)) || '';
  const system = (req.body && String(req.body.system || '')) || '';
  const history = Array.isArray(req.body?.history) ? req.body.history.slice(-10) : [];
  const flight = req.body?.flight;
  const flightCtx = req.body?.flight_context;
  if (!input) return res.status(400).json({ error: 'input required' });
  try {
    if (!apiKey) {
      const lines = [];
      if (system) lines.push(`[SYSTEM]\n${system}`);
      if (flight) lines.push(`[FLIGHT]\n${JSON.stringify(flight)}`);
      if (flightCtx) lines.push(`[CONTEXT]\n${JSON.stringify(flightCtx)}`);
      lines.push(`[USER]\n${input}`);
      return res.json({ provider: 'stub', text: lines.join('\n\n').slice(0, 4000) });
    }
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const contents = [];
    if (system) contents.push({ role: 'user', parts: [{ text: system }] });
    if (flight) contents.push({ role: 'user', parts: [{ text: `[選択中のフライト]\n${JSON.stringify(flight)}` }] });
    if (flightCtx) contents.push({ role: 'user', parts: [{ text: `[コンテキスト]\n${JSON.stringify(flightCtx)}` }] });
    for (const msg of history) {
      const role = msg.role === 'assistant' ? 'model' : 'user';
      contents.push({ role, parts: [{ text: String(msg.text || '') }] });
    }
    contents.push({ role: 'user', parts: [{ text: input }] });
    const body = { contents };
    const json = await postJson(url, { body });
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    res.json({ provider: 'gemini', text });
  } catch (e) {
    console.error('chat2 error:', e);
    res.status(500).json({ error: 'chat failed' });
  }
});

function postJson(url, { headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = Buffer.from(JSON.stringify(body));
    const opts = {
      method: 'POST',
      hostname: u.hostname,
      path: u.pathname + (u.search || ''),
      port: u.protocol === 'https:' ? 443 : 80,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
        ...headers,
      },
    };
    const m = u.protocol === 'https:' ? https : http;
    const req = m.request(opts, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`HTTP ${res.statusCode}: ${buf}`));
        }
        try { resolve(JSON.parse(buf)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

app.post('/chat', async (req, res) => {
  const apiKey = GEMINI_API_KEY;
  const input = (req.body && String(req.body.input || '').slice(0, 4000)) || '';
  const system = (req.body && String(req.body.system || '')) || '';
  const history = Array.isArray(req.body?.history) ? req.body.history.slice(-10) : [];
  const flight = req.body?.flight;
  if (!input) return res.status(400).json({ error: 'input required' });
  try {
    if (!apiKey) {
      const prefix = system ? `【${system}】\n` : '';
      const context = flight ? `\n[選択中のフライト]\n${JSON.stringify(flight)}` : '';
      return res.json({ provider: 'stub', text: `${prefix}${input}${context}` });
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const contents = [];
    if (system) contents.push({ role: 'user', parts: [{ text: system }] });
    if (flight) contents.push({ role: 'user', parts: [{ text: `[選択中のフライト]
${JSON.stringify(flight)}` }] });
    for (const msg of history) {
      const role = msg.role === 'assistant' ? 'model' : 'user';
      contents.push({ role, parts: [{ text: String(msg.text || '') }] });
    }
    contents.push({ role: 'user', parts: [{ text: input }] });

    const body = { contents };
    const json = await postJson(url, { body });
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    res.json({ provider: 'gemini', text });
  } catch (e) {
    console.error('chat error:', e);
    res.status(500).json({ error: 'chat failed' });
  }
});

app.listen(PORT, () => {
  console.log(`flight-proxy listening on http://localhost:${PORT}`);
});
