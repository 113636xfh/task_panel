export type BusEvent = { seq: number; ts: number; kind: string; payload: any };

type Handler = (ev: BusEvent) => void;

const handlers = new Set<Handler>();
let ws: WebSocket | null = null;
let lastSeq = 0;
let closedByUser = false;

export const wsState = { online: false };

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws?since=${lastSeq}`);
  ws.onopen = () => { wsState.online = true; };
  ws.onmessage = (m) => {
    try {
      const ev: BusEvent = JSON.parse(m.data);
      lastSeq = Math.max(lastSeq, ev.seq);
      for (const h of handlers) h(ev);
    } catch (e) {
      console.error('[ws] handler error', e);
    }
  };
  ws.onclose = () => {
    wsState.online = false;
    if (!closedByUser) setTimeout(connect, 1500);
  };
  ws.onerror = () => ws?.close();
}

export function onEvent(h: Handler): () => void {
  handlers.add(h);
  return () => handlers.delete(h);
}

if (typeof window !== 'undefined') connect();
