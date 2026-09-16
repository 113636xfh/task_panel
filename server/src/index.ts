import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { ROOT } from './db.js';
import { attachSocket } from './bus.js';
import { api } from './api.js';
import { startScheduler, recoverOrphans } from './scheduler.js';

const port = Number(process.env.TP_PORT ?? 8787);

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use('/api', api);

// 静态文件（生产/预览）
const dist = path.join(ROOT, 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/(api|ws)(\/|$)).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws, req) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const since = Number(url.searchParams.get('since') ?? 0);
  attachSocket(ws, Number.isFinite(since) ? since : 0);
});

recoverOrphans();
startScheduler();

server.listen(port, () => {
  console.log(`[task-panel] http://localhost:${port}  (api=/api, ws=/ws)`);
});
