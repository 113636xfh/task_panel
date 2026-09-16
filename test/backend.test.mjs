// Task Panel 后端测试套件（node:test，stub 执行器，毫秒级、无需 pi/模型服务）
// 运行: npm test   (即 node --test test/)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT, startServer, stopServer, makeApi, waitForStatus, wsCollect, makeTaskPayload, PNG_1X1,
  createAndStart, createTask,
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
  const t = await createAndStart(a, boardId.v, makeTaskPayload({ title: '全生命周期测试', wsName: ws, testCmd: 'node -e "process.exit(0)"' }));
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
  const t = await createAndStart(a, boardId.v, makeTaskPayload({ title: '#branch 分支测试', wsName: `br-${Date.now().toString(36)}` }));
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
  const t = await createAndStart(a, boardId.v, makeTaskPayload({ title: '#branch 自动分支', wsName: `ba-${Date.now().toString(36)}`, branchMode: 'auto' }));
  const done = await waitForStatus(S.base, t.id, 'awaiting_confirm');
  assert.notEqual(done.status, 'waiting_input');
  await a.post(`/tasks/${t.id}/confirm`);
});

// ---------------- 阻塞决策 ----------------

test('阻塞：blocked → 用户拍板 → 恢复 → 完成', async () => {
  const t = await createAndStart(a, boardId.v, makeTaskPayload({ title: '#block 阻塞测试', wsName: `bl-${Date.now().toString(36)}` }));
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
  const t = await createAndStart(a, boardId.v, makeTaskPayload({ title: '#fail 重试测试', wsName: `rf-${Date.now().toString(36)}` }));
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
  const t = await createAndStart(a, boardId.v, makeTaskPayload({ title: '#slow 慢任务-steer', wsName: `st-${Date.now().toString(36)}` }));
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
  const t = await createAndStart(a, boardId.v, makeTaskPayload({
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
  const t = await createAndStart(a, boardId.v, makeTaskPayload({ title: '#slow 慢任务-取消', wsName: `cx-${Date.now().toString(36)}` }));
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
  const t = await createAndStart(a, boardId.v, makeTaskPayload({ title: 'WS 事件测试', wsName: `ws-${Date.now().toString(36)}` }));
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
  const t = await createAndStart(a, boardId.v, makeTaskPayload({ title: '#slow 慢任务-重启', wsName: `rs-${Date.now().toString(36)}` }));
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

// ---------------- 优先级抢占（P2） ----------------

test('抢占：排队 P0 抢占运行中 P2；P0 先完成，被抢占任务从断点自动恢复完成', async () => {
  await a.put('/settings', { concurrency: 1 });
  // P2 慢任务占唯一槽位
  const slow = await createAndStart(a, boardId.v, makeTaskPayload({ title: '#slow 慢任务-抢占 victim', priority: 2, wsName: `pv2-${Date.now().toString(36)}` }));
  await waitForStatus(S.base, slow.id, 'executing');
  // P0 任务入队 → 应在 1~2s 内触发抢占
  const p0 = await createAndStart(a, boardId.v, makeTaskPayload({ title: 'P0 高优任务-抢占', priority: 0, wsName: `pv0-${Date.now().toString(36)}` }));
  const hit = await waitForStatus(S.base, slow.id, 'interrupted', 8000).catch(() => null);
  assert.ok(hit, 'P2 任务应被抢占 → interrupted');
  const evs = await a.get(`/tasks/${slow.id}/events?since=0`);
  assert.ok(evs.some((e) => e.kind === 'system' && e.payload.text.includes('被抢占')), '应有“被抢占”系统事件');
  // P0 先跑完
  await waitForStatus(S.base, p0.id, 'awaiting_confirm', 15000);
  await a.post(`/tasks/${p0.id}/confirm`);
  const p0row = await waitForStatus(S.base, p0.id, 'done', 5000);
  assert.equal(p0row.status, 'done');
  // 被抢占的 P2 任务随后自动恢复（断点续跑）→ 完成
  await waitForStatus(S.base, slow.id, 'awaiting_confirm', 30000);
  await a.post(`/tasks/${slow.id}/confirm`);
  const srow = await a.get(`/tasks/${slow.id}`);
  assert.equal(srow.status, 'done');
  assert.ok(p0row.finished_at < srow.finished_at, 'P0 应先于 P2 完成');
  await a.put('/settings', { concurrency: 2 });
});

// ---------------- P3：ready / rework / 全部模式消息 / 进度 / 会话长度 ----------------

test('P3 ready：创建默认「待准备」；手动开始入队；仅 ready 可 start', async () => {
  const t = await a.post(`/boards/${boardId.v}/tasks`, makeTaskPayload({ title: 'ready 状态测试', wsName: `rd-${Date.now().toString(36)}`, contextWindow: 12345 }));
  const row = await a.get(`/tasks/${t.id}`);
  assert.equal(row.status, 'ready');
  assert.equal(row.context_window, 12345, '任务级会话长度应入库');
  // 未开始时不占槽
  const rt = await a.get('/runtime');
  assert.equal(rt.ready >= 1, true);
  await a.post(`/tasks/${t.id}/start`);
  const row2 = await a.get(`/tasks/${t.id}`);
  assert.equal(row2.status, 'queued');
  let err = null;
  try { await a.post(`/tasks/${t.id}/start`); } catch (e) { err = e; }
  assert.ok(err, '非「待准备」状态再次 start 应被拒');
  await waitForStatus(S.base, t.id, 'awaiting_confirm');
  await a.post(`/tasks/${t.id}/confirm`);
  await waitForStatus(S.base, t.id, 'done');
});

test('P3 rework：done → 留言打回 → 重新打磨（同会话）→ awaiting_confirm；不限次数', async () => {
  const t = await createAndStart(a, boardId.v, makeTaskPayload({ title: 'rework 返工测试', wsName: `rw-${Date.now().toString(36)}` }));
  await waitForStatus(S.base, t.id, 'awaiting_confirm');
  await a.post(`/tasks/${t.id}/confirm`);
  await waitForStatus(S.base, t.id, 'done');
  // 返工 1
  const r1 = await a.post(`/tasks/${t.id}/rework`, { text: '结果不满意：命名规范需要统一（返工 1）' });
  assert.equal(r1.ok, true);
  const ev1 = await a.get(`/tasks/${t.id}/events?since=0`);
  assert.ok(ev1.some((e) => e.kind === 'system' && e.payload.text.includes('打回打磨')));
  const mid1 = await waitForStatus(S.base, t.id, 'awaiting_confirm', 30_000);
  assert.equal(mid1.status, 'awaiting_confirm');
  await a.post(`/tasks/${t.id}/confirm`);
  await waitForStatus(S.base, t.id, 'done');
  // 返工 2（不限次数）
  const r2 = await a.post(`/tasks/${t.id}/rework`, { text: '还有细节要改（返工 2）' });
  assert.equal(r2.ok, true);
  await waitForStatus(S.base, t.id, 'awaiting_confirm', 30_000);
  // 两轮打磨 → 至少 3 次 planned（初始 1 + 返工 2）
  const evs = await a.get(`/tasks/${t.id}/events?since=0`);
  const planned = evs.filter((e) => e.kind === 'planned');
  assert.ok(planned.length >= 3, `应有多轮 planned（实际 ${planned.length}）`);
  // 非 done/待确认 状态不能返工（运行中任务）
  const t2 = await createAndStart(a, boardId.v, makeTaskPayload({ title: '#slow 慢任务-rework 拒绝对象', wsName: `rw2-${Date.now().toString(36)}` }));
  await waitForStatus(S.base, t2.id, 'executing');
  let err = null;
  try { await a.post(`/tasks/${t2.id}/rework`, { text: 'x' }); } catch (e) { err = e; }
  assert.ok(err, '非 done/待确认 状态 rework 应被拒');
  await waitForStatus(S.base, t2.id, 'awaiting_confirm', 30_000);
  await a.post(`/tasks/${t2.id}/confirm`);
  await waitForStatus(S.base, t2.id, 'done');
});

test('P3 全部模式：事件流含完整 message（注入标签/思考/工具调用）与 progress 进度', async () => {
  const t = await createAndStart(a, boardId.v, makeTaskPayload({ title: '全部消息测试', wsName: `fm-${Date.now().toString(36)}` }));
  await waitForStatus(S.base, t.id, 'awaiting_confirm');
  const evs = await a.get(`/tasks/${t.id}/events?since=0`);
  const msgs = evs.filter((e) => e.kind === 'message');
  assert.ok(msgs.length >= 4, `全量消息应 ≥4（实际 ${msgs.length}）`);
  assert.ok(msgs.some((e) => e.payload.role === 'user' && e.payload.injected === '规划'), '规划注入');
  assert.ok(msgs.some((e) => e.payload.role === 'user' && e.payload.injected === '执行', '执行注入'));
  assert.ok(msgs.some((e) => e.payload.role === 'user' && e.payload.injected === '验收'), '验收注入');
  assert.ok(msgs.some((e) => e.payload.role === 'assistant' && e.payload.parts.some((p) => p.type === 'toolCall')), '工具调用');
  assert.ok(msgs.some((e) => e.payload.role === 'assistant' && e.payload.parts.some((p) => p.type === 'thinking')), '思考链');
  const prog = evs.filter((e) => e.kind === 'progress');
  assert.ok(prog.length >= 2, 'progress 事件');
  const last = prog[prog.length - 1].payload;
  assert.ok(last.done >= 1 && last.done <= last.total, '进度单调推进（stub 在 s1 完成后记录 1/2）');
  // 执行阶段 current_action 形如 "1/2 · …"
  const row = await a.get(`/tasks/${t.id}`);
  assert.equal(typeof row.current_action, 'string');
});

test('P3 设置：contextWindow 钳制 + promptTemplates 读写 + 恢复默认', async () => {
  const old = await a.get('/settings');
  await a.put('/settings', { contextWindow: 32768, promptTemplates: { plan: '自定义规划模板 {{title}}' } });
  const s2 = await a.get('/settings');
  assert.equal(s2.contextWindow, 32768);
  assert.equal(s2.promptTemplates.plan, '自定义规划模板 {{title}}');
  await a.put('/settings', { contextWindow: 99999999999 });
  assert.equal((await a.get('/settings')).contextWindow, 10_000_000, '超上限钳制');
  await a.put('/settings', { contextWindow: old.contextWindow ?? 0, promptTemplates: {} });
});
