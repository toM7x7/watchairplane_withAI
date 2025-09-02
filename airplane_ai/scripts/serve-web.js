#!/usr/bin/env node
// Minimal static server for ./web (no deps)
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const ROOT = path.join(process.cwd(), 'web');

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml'
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 404, 'Not Found');
    const ext = path.extname(filePath).toLowerCase();
    send(res, 200, data, { 'Content-Type': types[ext] || 'application/octet-stream' });
  });
}

function handler(req, res) {
  const urlPath = decodeURI((req.url || '/').split('?')[0]);
  let filePath = path.join(ROOT, urlPath);

  // Prevent path traversal
  if (!filePath.startsWith(ROOT)) {
    return send(res, 400, 'Bad Request');
  }

  fs.stat(filePath, (err, stat) => {
    if (!err && stat.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }
    fs.stat(filePath, (err2) => {
      if (err2) {
        // Fallback to index.html for SPA-like routing
        return serveFile(res, path.join(ROOT, 'index.html'));
      }
      serveFile(res, filePath);
    });
  });
}

function createServer() {
  const useHttps = /^(1|true|yes)$/i.test(String(process.env.HTTPS || ''));
  if (useHttps) {
    try {
      const keyPath = process.env.SSL_KEY_FILE;
      const crtPath = process.env.SSL_CRT_FILE;
      if (!keyPath || !crtPath) throw new Error('SSL_KEY_FILE/SSL_CRT_FILE not set');
      const key = fs.readFileSync(keyPath);
      const cert = fs.readFileSync(crtPath);
      return { server: https.createServer({ key, cert }, handler), scheme: 'https' };
    } catch (e) {
      console.warn('[serve-web] HTTPS requested but failed, falling back to HTTP:', e.message || e);
    }
  }
  return { server: http.createServer(handler), scheme: 'http' };
}

const { server, scheme } = createServer();
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Serving ./web at ${scheme}://localhost:${PORT} (LAN access via ${scheme}://<PC-IP>:${PORT})`);
});
