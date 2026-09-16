import type { WebSocket } from 'ws';

export type BusEvent = { seq: number; ts: number; kind: string; payload: unknown };

const recent: BusEvent[] = [];
const RECENT_CAP = 5000;
let seq = 0;
const clients = new Set<WebSocket>();

export function publish(kind: string, payload: unknown): BusEvent {
  const ev: BusEvent = { seq: ++seq, ts: Date.now(), kind, payload };
  recent.push(ev);
  if (recent.length > RECENT_CAP) recent.splice(0, recent.length - RECENT_CAP);
  const msg = JSON.stringify(ev);
  for (const c of clients) if (c.readyState === 1) c.send(msg);
  return ev;
}

export function replay(since: number): BusEvent[] {
  return recent.filter((e) => e.seq > since);
}

export function attachSocket(ws: WebSocket, since: number) {
  clients.add(ws);
  for (const e of replay(since)) ws.send(JSON.stringify(e));
  ws.on('message', (d) => {
    try {
      const m = JSON.parse(String(d));
      if (typeof m.since === 'number') for (const e of replay(m.since)) ws.send(JSON.stringify(e));
    } catch { /* ignore malformed */ }
  });
  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
}

export function clientCount() {
  return clients.size;
}
