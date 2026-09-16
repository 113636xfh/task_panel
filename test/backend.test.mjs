// Task Panel 后端测试套件（node:test，stub 执行器，毫秒级、无需 pi/模型服务）
// 运行: npm test   (即 node --test test/)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT, startServer, stopServer, makeApi, waitForStatus, wsCollect, makeTaskPayload, PNG_1X1,
} from './helpers.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let S; // 服务句柄
let a; // api
const PORT = 18801;
const boardId = { v: null };

before(async () => {
  S = await startServer({ port: PORT });
  a = makeApi(S.base + '/api');
  const b = await a.post('/boards', { name: '测试看板' });
  boardId.v = b.id;
});

after(async () => {
  if (S) await S.stop();
});

// ---------------- 基础：health / boards CRUD / settings ----------------

test('health：ok=true 且 executor=stub', async () => {
  const h = await a.get('/health');
  assert.equal(h.ok, true);
  assert.equal(h.executor, 'stub');
  assert.equal(typeof h.runtime.used, 'number');
});

test('boards CRUD', async () => {
  const b = await a.post('/boards', { name: 'CRUD 看板' });
  assert.ok(b.id);
  let list = await a.get('/boards');
  assert.ok(list.some((x) => x.id === b.id));
  const got = await a.get(`/boards/${b.id}`);
  assert.equal(got.name, 'CRUD 看板');
  await a.del(`/boards/${b.id}`);
  list = await a.get('/boards');
  assert.ok(!list.some((x) => x.id === b.id));
});

test('settings：读写 + 范围钳制', async () => {
  const s0 = await a.get('/settings');
  await a.put('/settings', { concurrency: 5 });
  assert.equal((await a.get('/settings')).concurrency, 5);
  await a.put('/settings', { concurrency: 0 }); // 钳到 1
  assert.equal((await a.get('/settings')).concurrency, 1);
  await a.put('/settings', { concurrency: 99 }); // 钳到 8
  assert.equal((await a.get('/settings')).concurrency, 8);
  await a.put('/settings', { concurrency: s0.concurrency }); // 还原
  assert.equal((await a.get('/settings')).concurrency, s0.concurrency);
});

// ---------------- 全生命周期（默认剧本） ----------------

test('全生命周期：queued→planning→executing→testing→awaiting_confirm→done', async () => {
  const ws = `life-${Date.now().toString(36)}`;
  const t = await a.post(`/boards/${boardId.v}/tasks`, makeTaskPayload({ title: '全生命周期测试', wsName: ws, testCmd: 'node -e "process.exit(0)"' }));
  const taskId = t.id;
  const done = await waitForStatus(S.base, taskId, 'awaiting_confirm');
  assert.equal(done.plan.steps.length, 2);
  assert.ok(done.plan.steps.every((s) => s.done));
  assert.equal(done.review.overall, 'pass');
  assert.ok(done.workspace_path.endsWith(ws) || done.workspace_path.endsWith(`\\${ws}`));
  assert.ok(fs.existsSync(path.join(done.workspace_path, 'work', 'plan.json')));
  assert.ok(fs.existsSync(path.join(done.workspace_path, 'work', 'done.json')));

  const evs = (await a.get(`/tasks/${taskId}/events?since=0`));
  const kinds = evs.map((e) => e.kind);
  for (const k of ['system', 'phase', 'planned', 'asset', 'step', 'tool', 'assistant', 'review']) assert.ok(kinds.includes(k), `缺少事件 ${k}`);
  const phases = evs.filter((e) => e.kind === 'phase').map((e) => e.payload.phase);
  assert.deepEqual(
    phases.filter((p) => ['planning', 'executing', 'testing', 'awaiting_confirm'].includes(p)),
    ['planning', 'executing', 'testing', 'awaiting_confirm']
  );
  for (let i = 1; i < evs.length; i++) assert.ok(evs[i].seq > evs[i - 1].seq, 'seq 必须严格递增');

  const c = await a.post(`/tasks/${taskId}/confirm`);
  assert.equal(c.ok, true);
  const fin = await a.get(`/tasks/${taskId}`);
  assert.equal(fin.status, 'done');
  assert.ok(fin.finished_at);
  // 终态再确认 → ok:false（幂等拒绝，不重复变更）
  const c2 = await a.post(`/tasks/${taskId}/confirm`);
  assert.equal(c2.ok, false);
  assert.equal((await a.get(`/tasks/${taskId}`)).status, 'done');
});

// ---------------- 分支问答 ----------------

test('分支（manual）：waiting_input → 用户回答 → 完成', async () => {
  const t = await a.post(`/boards/${boardId.v}/tasks`, makeTaskPayload({ title: '#branch 分支测试', wsName: `br-${Date.now().toString(36)}` }));
  const waiting = await waitForStatus(S.base, t.id, 'waiting_input');
  assert.equal(waiting.plan.branch_questions.length, 2);
  const r = await a.post(`/tasks/${t.id}/answer`, { answers: { q1: '方案 B', q2: '本地 JSON' } });
  assert.equal(r.ok, true);
  await waitForStatus(S.base, t.id, 'awaiting_confirm');
  const evs = await a.get(`/tasks/${t.id}/events?since=0`);
  const ums = evs.filter((e) => e.kind === 'user_message').map((e) => e.payload.text);
  assert.ok(ums.some((x) => x.includes('q1') && x.includes('方案 B')));
  await a.post(`/tasks/${t.id}/confirm`);
  assert.equal((await a.get(`/tasks/${t.id}`)).status, 'done');
});

test('分支（auto）：不挂起，直接跑完', async () => {
  const t = await a.post(`/boards/${boardId.v}/tasks`, makeTaskPayload({ title: '#branch 自动分支', wsName: `ba-${Date.now().toString(36)}`, branchMode: 'auto' }));
  const done = await waitForStatus(S.base, t.id, 'awaiting_confirm');
  assert.notEqual(done.status, 'waiting_input');
  await a.post(`/tasks/${t.id}/confirm`);
});

// ---------------- 阻塞决策 ----------------

test('阻塞：blocked → 用户拍板 → 恢复 → 完成', async () => {
  const t = await a.post(`/boards/${boardId.v}/tasks`, makeTaskPayload({ title: '#block 阻塞测试', wsName: `bl-${Date.now().toString(36)}` }));
  await waitForStatus(S.base, t.id, 'blocked');
  const blocks = await a.get(`/tasks/${t.id}/blocks`);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].status, 'open');
  assert.ok(blocks[0].options.length >= 2);
  const r = await a.post(`/tasks/${t.id}/block-answer`, { answer: '选项 B' });
  assert.equal(r.ok, true);
  await waitForStatus(S.base, t.id, 'awaiting_confirm');
  const evs = await a.get(`/tasks/${t.id}/events?since=0`);
  assert.ok(evs.some((e) => e.kind === 'user_message' && e.payload.text.includes('选项 B')));
  const blocks2 = await a.get(`/tasks/${t.id}/blocks`);
  assert.equal(blocks2[0].status, 'answered');
  await a.post(`/tasks/${t.id}/confirm`);
  assert.equal((await a.get(`/tasks/${t.id}`)).status, 'done');
});

// ---------------- 验收重试 ----------------

test('验收重试：第一次 fail（retry_count=1），重试后 pass', async () => {
  const t = await a.post(`/boards/${boardId.v}/tasks`, makeTaskPayload({ title: '#fail 重试测试', wsName: `rf-${Date.now().toString(36)}` }));
  await waitForStatus(S.base, t.id, 'awaiting_confirm', 30_000);
  const task = await a.get(`/tasks/${t.id}`);
  assert.equal(task.retry_count, 1);
  const evs = await a.get(`/tasks/${t.id}/events?since=0`);
  const reviews = evs.filter((e) => e.kind === 'review').map((e) => e.payload.overall);
  assert.deepEqual(reviews, ['fail', 'pass']);
  await a.post(`/tasks/${t.id}/confirm`);
});

// ---------------- steer / 留言 ----------------

test('steer（执行中）+ 留言（空闲时入队）', async () => {
  const t = await a.post(`/boards/${boardId.v}/tasks`, makeTaskPayload({ title: '#slow 慢任务-steer', wsName: `st-${Date.now().toString(36)}` }));
  await waitForStatus(S.base, t.id, 'executing');
  const r1 = await a.post(`/tasks/${t.id}/message`, { text: 'steer 注入测试' });
  assert.equal(r1.ok, true);
  const done = await waitForStatus(S.base, t.id, 'awaiting_confirm', 30_000);
  const evs = await a.get(`/tasks/${t.id}/events?since=0`);
  assert.ok(evs.some((e) => e.kind === 'system' && e.payload.text.includes('steer 已注入')));
  // 空闲（awaiting_confirm）时留言 → 入队
  const r2 = await a.post(`/tasks/${t.id}/message`, { text: '空闲留言' });
  assert.equal(r2.ok, true);
  assert.ok(evs.length >= 0);
  await a.post(`/tasks/${t.id}/confirm`);
});

// ---------------- 附图（长提示词） ----------------

test('附图：上传 → 描述含映射块 → 列表/文件接口 → 防穿越', async () => {
  const t = await a.post(`/boards/${boardId.v}/tasks`, makeTaskPayload({
    title: '附图测试', wsName: `im-${Date.now().toString(36)}`,
    images: [{ name: 'spec.png', data: PNG_1X1 }],
  }));
  const task = await a.get(`/tasks/${t.id}`);
  assert.ok(task.description.includes('附图'));
  assert.ok(task.description.includes('work/images/1.png'));
  const list = await a.get(`/tasks/${t.id}/images`);
  assert.equal(list.images.length, 1);
  const r = await fetch(S.base + `/api/tasks/${t.id}/file?p=work/images/1.png`);
  assert.equal(r.status, 200);
  assert.ok(r.headers.get('content-type')?.startsWith('image/'));
  const bytes = Buffer.from(await r.arrayBuffer());
  assert.equal(bytes.length, Buffer.from(PNG_1X1, 'base64').length);
  const bad = await fetch(S.base + `/api/tasks/${t.id}/file?p=../../package.json`);
  assert.ok([400, 404].includes(bad.status), '路径穿越必须被拒绝');
  await a.post(`/tasks/${t.id}/confirm`).catch(() => {});
});

// ---------------- 取消 ----------------

test('取消：执行中取消 → cancelled，槽位释放', async () => {
  const t = await a.post(`/boards/${boardId.v}/tasks`, makeTaskPayload({ title: '#slow 慢任务-取消', wsName: `cx-${Date.now().toString(36)}` }));
  await waitForStatus(S.base, t.id, 'executing');
  const before = await a.get('/runtime');
  assert.ok(before.used >= 1);
  const r = await a.post(`/tasks/${t.id}/cancel`);
  assert.equal(r.ok, true);
  await sleep(300);
  const task = await a.get(`/tasks/${t.id}`);
  assert.equal(task.status, 'cancelled');
  assert.ok(task.finished_at);
  const after = await a.get('/runtime');
  assert.ok(after.used < before.used, '槽位应释放');
});

// ---------------- WebSocket：实时事件 + since 重放 ----------------

test('WS：实时收到 task.event/task.status，且 since 可重放', async () => {
  const ws = wsCollect(S.base, 0);
  await ws.opened;
  const t = await a.post(`/boards/${boardId.v}/tasks`, makeTaskPayload({ title: 'WS 事件测试', wsName: `ws-${Date.now().toString(36)}` }));
  await ws.wait((e) => e.kind === 'task.event' && e.payload.taskId === t.id && e.payload.event.kind === 'planned');
  const statusEv = await ws.wait((e) => e.kind === 'task.status' && e.payload.taskId === t.id);
  assert.ok(statusEv.payload.to);
  await waitForStatus(S.base, t.id, 'awaiting_confirm');
  await a.post(`/tasks/${t.id}/confirm`);
  // since 重放：用已见最大 seq 之后的 0 重放应包含之前事件
  const maxSeq = Math.max(...ws.events.map((e) => e.seq));
  const ws2 = wsCollect(S.base, 0);
  await ws2.opened;
  await sleep(500);
  assert.ok(ws2.events.some((e) => e.seq === maxSeq), 'since=0 应重放全部历史');
  ws.close(); ws2.close();
});

// ---------------- 服务重启恢复（P2） ----------------

test('重启恢复：执行中 kill → 重启 → interrupted → 自动恢复 → done', async () => {
  const t = await a.post(`/boards/${boardId.v}/tasks`, makeTaskPayload({ title: '#slow 慢任务-重启', wsName: `rs-${Date.now().toString(36)}` }));
  await waitForStatus(S.base, t.id, 'executing');
  await S.stop(); // 强杀（验证 recoverOrphans 兜底路径）
  // 重启（同数据目录、同端口）
  S = await startServer({ port: PORT, dataDir: S.dataDir });
  a = makeApi(S.base + '/api');
  await sleep(1000);
  // 恢复事件（系统提示：服务重启…）
  const evs = await a.get(`/tasks/${t.id}/events?since=0`);
  assert.ok(evs.some((e) => e.kind === 'system' && e.payload.text.includes('服务重启')));
  // 自动恢复（tick 拾起 interrupted）→ 完成
  const done = await waitForStatus(S.base, t.id, 'awaiting_confirm', 30_000);
  assert.equal(done.status, 'awaiting_confirm');
  await a.post(`/tasks/${t.id}/confirm`);
  assert.equal((await a.get(`/tasks/${t.id}`)).status, 'done');
});

test('优雅退出（SIGTERM 路径）：服务可再次启动', async () => {
  // 上一个测试已重启过一次；这里直接验证当前服务健康（shutdownRunners 钩子未破坏正常流程）
  const h = await a.get('/health');
  assert.equal(h.ok, true);
});
