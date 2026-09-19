import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { ROOT } from './db.js';
import { attachSocket } from './bus.js';
import { api } from './api.js';
import { startScheduler, recoverOrphans, shutdownRunners, claimSingleton, releaseSingleton, killOrphanRunners } from './scheduler.js';

const port = Number(process.env.TP_PORT ?? 8787);

const app = express();
app.use(express.json({ limit: '16mb' }));
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

// 单实例守护：同一数据目录只允许一个服务实例（防止旧实例遗留导致双 runner / 孤儿 pi）
if (!claimSingleton()) process.exit(1);
// 清理上一轮硬杀遗留的孤儿 pi 子进程（仍在向模型服务发请求的那种）
killOrphanRunners();
recoverOrphans();
startScheduler();

// 退出前回收 pi 子进程（Windows 上孤儿 pi 进程会继续烧 token）
let shuttingDown = false;
function gracefulShutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  try { shutdownRunners(); } catch { /* ignore */ }
  releaseSingleton();
  setTimeout(() => process.exit(0), 500).unref?.();
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as NodeJS.Signals[]) process.on(sig, gracefulShutdown);
process.on('exit', () => { try { shutdownRunners(); releaseSingleton(); } catch { /* ignore */ } });

server.listen(port, () => {
  console.log(`[task-panel] http://localhost:${port}  (api=/api, ws=/ws)`);
});
