import WebSocket from 'ws';
const base = 'http://127.0.0.1:8787';
const j = async (m, u, b) => {
  const r = await fetch(base + '/api' + u, { method: m, headers: b ? { 'Content-Type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  return r.json();
};
const id = 't-mu8c670e-5mmrr8';
await j('POST', `/tasks/${id}/start`);
const ws = new WebSocket(`ws://127.0.0.1:8787/ws?since=0`);
let thinkDeltas = 0, textDeltas = 0, firstAt = null;
const t0 = Date.now();
ws.on('message', (d) => {
  const ev = JSON.parse(d.toString());
  if (ev.kind === 'task.stream' && ev.payload.taskId === id) {
    if (ev.payload.block === 'thinking') { thinkDeltas++; if (!firstAt) firstAt = Date.now() - t0; }
    else textDeltas++;
  }
});
const deadline = Date.now() + 300_000;
let final = '';
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 2000));
  const row = await j('GET', `/tasks/${id}`);
  if (['awaiting_confirm', 'failed', 'done'].includes(row.status)) { final = row.status; break; }
}
ws.close();
console.log(`status=${final} | thinking-deltas=${thinkDeltas} text-deltas=${textDeltas} first-think-at=${firstAt}ms elapsed=${Date.now() - t0}ms`);
const { execSync } = await import('node:child_process');
const out = execSync(`node -e "const db=require('node:sqlite').DatabaseSync;const d=new db('data/taskpanel.db',{readOnly:true});let n=0,len=0;for(const r of d.prepare(\\\"SELECT payload FROM task_events WHERE task_id='${id}' AND kind='message'\\\" ).all()){try{const p=JSON.parse(r.payload);for(const c of p.parts||[])if(c.type==='thinking'){n++;len+=c.text.length}}catch{}}console.log('persisted-thinking-blocks='+n+' chars='+len)"`, { encoding: 'utf8' });
console.log(out.trim());
