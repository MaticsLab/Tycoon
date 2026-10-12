import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Game } from './game.js';
import { loadWorld, saveWorld } from './store.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8080;
const DATA_FILE = process.env.DATA_FILE || path.join(here, '..', 'data', 'world.json');
const STATIC_DIR = process.env.STATIC_DIR || path.join(here, '..', '..', 'client', 'dist');

const game = new Game(loadWorld(DATA_FILE));

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

// Serves the built web client so one process hosts the whole game.
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, online: game.sessions.size }));
  }
  let file = path.normalize(path.join(STATIC_DIR, decodeURIComponent(url.pathname)));
  if (!file.startsWith(STATIC_DIR)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(STATIC_DIR, 'index.html');
  if (!fs.existsSync(file)) {
    res.writeHead(200, { 'content-type': 'text/plain' });
    return res.end('Tycoon server is running. Build the client (npm run build) to serve it from here.');
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });
wss.on('connection', (ws) => {
  const handlers = game.attach({
    sendRaw: (d) => { if (ws.readyState === ws.OPEN) ws.send(d); },
    close: () => ws.close(),
  });
  ws.on('message', (data) => handlers.onMessage(data.toString()));
  ws.on('close', handlers.onClose);
  ws.on('error', () => {});
});

setInterval(() => game.tick(), 100);
setInterval(() => {
  if (!game.dirty) return;
  game.dirty = false;
  saveWorld(DATA_FILE, game.snapshot());
}, 5000);

const shutdown = () => {
  for (const s of [...game.sessions.values()]) game.leave(s);
  saveWorld(DATA_FILE, game.snapshot());
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, () => console.log(`Tycoon server listening on http://localhost:${PORT} (ws path /ws)`));
