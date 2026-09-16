// Task Panel UI 测试：puppeteer-core 驱动真实浏览器（Edge/Chrome），以"人"的方式操作界面
// 运行: npm run test:ui   （先自动重新构建前端，再对 stub 服务做全流程人形操作 + 截图）
// 截图输出: test/ui-artifacts/*.png
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { ROOT, startServer, makeApi } from './helpers.mjs';

const ART = path.join(ROOT, 'test', 'ui-artifacts');
const PORT = 18802;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findBrowser() {
  if (process.env.TP_BROWSER && fs.existsSync(process.env.TP_BROWSER)) return process.env.TP_BROWSER;
  const cands = [
    process.env.ProgramFiles && path.join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  ].filter(Boolean);
  for (const c of cands) if (fs.existsSync(c)) return c;
  throw new Error('未找到 Edge/Chrome（可设 TP_BROWSER 指向浏览器可执行文件）');
}

let S, a, browser, page, shotN = 0;
let shot, shotFail;

before(async () => {
  fs.rmSync(ART, { recursive: true, force: true });
  fs.mkdirSync(ART, { recursive: true });
  // 确保前端产物包含最新 data-testid
  execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });
  S = await startServer({ port: PORT });
  a = makeApi(S.base + '/api');
  browser = await puppeteer.launch({
    executablePath: findBrowser(),
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'],
  });
  page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  page.on('console', (m) => console.log(`[page:console:${m.type()}]`, m.text().slice(0, 300)));
  page.on('pageerror', (e) => console.log('[page:pageerror]', String(e).slice(0, 500)));
  page.on('requestfailed', (r) => console.log('[page:reqfail]', r.url(), r.failure()?.errorText));
  shot = (name) => {
    shotN += 1;
    const p = path.join(ART, `${String(shotN).padStart(2, '0')}-${name}.png`);
    return page.screenshot({ path: p }).then(() => p);
  };
  shotFail = async (name) => { try { shotN += 1; await page.screenshot({ path: path.join(ART, `99-fail-${name}.png`) }); } catch { /* ignore */ } };
}, 240_000);

after(async () => {
  try { await browser?.close(); } catch { /* ignore */ }
  if (S) await S.stop();
});

test('UI 人形全流程：建看板 → 建任务 → 分支回答 → 确认 → 卡片入 done 列', async () => {
  try {
    await run1();
  } catch (e) {
    await shotFail('test1');
    throw e;
  }
});

async function run1() {
  // 1. 打开应用（空数据目录 → 空看板列表）
  await page.goto(S.base, { waitUntil: 'networkidle0' });
  await page.waitForSelector('[data-testid="btn-new-board"]', { visible: true });
  await shot('boards-empty');

  // 2. 新建看板
  await page.click('[data-testid="btn-new-board"]');
  await page.waitForSelector('[data-testid="input-board-name"]', { visible: true });
  await page.type('[data-testid="input-board-name"]', 'UI 人形测试看板');
  await shot('create-board-dialog');
  await page.click('[data-testid="btn-create-board"]');
  await page.waitForSelector('[data-testid="board-card"]', { visible: true });
  await shot('board-created');

  // 3. 进入看板（新建任务按钮可见，8 列看板）
  await page.click('[data-testid="board-card"]');
  await page.waitForSelector('[data-testid="btn-new-task"]', { visible: true });
  for (const col of ['queued', 'planning', 'waiting_input', 'executing', 'blocked', 'testing', 'awaiting_confirm', 'done']) {
    await page.waitForSelector(`[data-testid="col-${col}"]`, { visible: true });
  }
  await shot('kanban-empty');

  // 4. 新建任务（#branch 剧本：会触发分支问答）
  await page.click('[data-testid="btn-new-task"]');
  await page.waitForSelector('[data-testid="input-task-title"]', { visible: true });
  await page.type('[data-testid="input-task-title"]', '#branch 人形分支任务');
  await page.type('[data-testid="input-task-desc"]', '通过 UI 创建的测试任务，验证人形操作流程。');
  await page.type('[data-testid="input-ws-name"]', 'ui-branch');
  await shot('create-task-dialog');
  await page.click('[data-testid="btn-create-task"]');

  // 5. 任务卡出现在看板（queued/running 列），状态徽标流转
  await page.waitForSelector('[data-testid="task-card"][data-num="1"]', { visible: true });
  await shot('task-on-board');
  // 打开任务详情
  await page.click('[data-testid="task-card"][data-num="1"]');
  await page.waitForSelector('[data-testid="status-badge"]', { visible: true });
  const badgeText = () => page.$eval('[data-testid="status-badge"]', (el) => el.textContent.trim());
  const badgeClass = () => page.$eval('[data-testid="status-badge"]', (el) => el.className);
  // 等分支问答（等待输入）
  await page.waitForSelector('[data-testid="branch-opt"]', { visible: true, timeout: 30_000 });
  assert.match(await badgeClass(), /st-waiting_input/);
  await shot('branch-questions');

  const waitStatus = async (s, timeout = 10_000) => {
    const deadline = Date.now() + timeout;
    for (;;) {
      const cls = await page.$eval('[data-testid="status-badge"]', (el) => el.className).catch(() => '');
      if (cls.includes(`st-${s}`)) return;
      if (Date.now() > deadline) throw new Error(`状态未到达 st-${s}（当前 ${cls}）`);
      await new Promise((r) => setTimeout(r, 250));
    }
  };

  // 6. 逐题选择选项并提交（人形：点第 2 个选项、第 1 个选项）
  await page.click('[data-testid="branch-opt"][data-idx="1"]');
  await page.click(`[data-testid="branch-opt"][data-q="q2"][data-idx="0"]`);
  await shot('branch-selected');
  await page.click('[data-testid="btn-branch-submit"]');

  // 7. 执行 → 测试 → 待确认
  await page.waitForSelector('[data-testid="btn-confirm-done"]', { visible: true, timeout: 30_000 });
  assert.match(await badgeClass(), /st-awaiting_confirm/);
  await shot('awaiting-confirm');

  // 8. 用户确认 → done
  await page.click('[data-testid="btn-confirm-done"]');
  await waitStatus('done', 10_000);
  await shot('task-done');

  // 9. 返回看板：卡片应位于 done 列
  const board = (await a.get('/boards'))[0];
  await page.goto(`${S.base}/boards/${board.id}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('[data-testid="col-done"] [data-testid="task-card"][data-num="1"]', { visible: true });
  const doneColCount = await page.$$eval('[data-testid="col-done"] [data-testid="task-card"]', (els) => els.length);
  assert.equal(doneColCount, 1);
  await shot('card-in-done-col');
}

test('UI 人形：steer 留言 + 长文展开 + 主题/语言切换', async () => {
  try {
    await run2();
  } catch (e) {
    await shotFail('test2');
    throw e;
  }
});

async function run2() {
  // 先回到看板页（上一个测试可能停在任务详情）
  const board = (await a.get('/boards'))[0];
  await page.goto(`${S.base}/boards/${board.id}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('[data-testid="btn-new-task"]', { visible: true });

  // 取当前看板最大序号（下一个新任务的 num）
  const tasks0 = await a.get(`/boards/${board.id}/tasks`);
  const nextNum = tasks0.length ? Math.max(...tasks0.map((t) => t.num)) + 1 : 1;

  // 建一个 #slow 任务（执行 5s，留 steer 窗口）
  await page.click('[data-testid="btn-new-task"]');
  await page.waitForSelector('[data-testid="input-task-title"]', { visible: true });
  await page.type('[data-testid="input-task-title"]', '#slow 人形 steer 任务');
  await page.type('[data-testid="input-task-desc"]', 'steer 测试任务。');
  await page.type('[data-testid="input-ws-name"]', 'ui-slow');
  await page.click('[data-testid="btn-create-task"]');
  await page.waitForSelector(`[data-testid="task-card"][data-num="${nextNum}"]`, { visible: true, timeout: 30_000 });
  await page.click(`[data-testid="task-card"][data-num="${nextNum}"]`);

  // 执行中：输入 steer 并发送
  await page.waitForSelector('[data-testid="input-msg-short"]', { visible: true, timeout: 30_000 });
  await page.type('[data-testid="input-msg-short"]', '人形 steer：请优先处理边界情况。');
  await shot('steer-typed');
  await page.click('[data-testid="btn-msg-send-short"]');
  // 发送后 feed 出现 user 气泡
  await page.waitForFunction(
    () => document.querySelector('[data-testid="feed"]')?.textContent.includes('人形 steer：请优先处理边界情况。') ?? false,
    { timeout: 10_000 }
  );
  await shot('steer-sent');

  // 长文模式：展开 → 输入长文 → 发送（feed 出现第二个人形气泡）
  await page.click('[data-testid="btn-msg-expand"]');
  await page.waitForSelector('[data-testid="input-msg-long"]', { visible: true, timeout: 10_000 });
  await page.type('[data-testid="input-msg-long"]', '长文 steer 测试：第一行。\n第二行，验证多行输入框与换行渲染。');
  await shot('steer-long-typed');
  await page.click('[data-testid="btn-msg-send-long"]');
  await page.waitForFunction(
    () => document.querySelector('[data-testid="feed"]')?.textContent.includes('长文 steer 测试：第一行。') ?? false,
    { timeout: 10_000 }
  );
  await shot('steer-long-sent');

  // 等任务到待确认 → 人形确认 → done
  await page.waitForSelector('[data-testid="btn-confirm-done"]', { visible: true, timeout: 60_000 });
  await page.click('[data-testid="btn-confirm-done"]');
  await page.waitForFunction(
    () => document.querySelector('[data-testid="status-badge"]')?.className.includes('st-done') ?? false,
    { timeout: 10_000 }
  );
  const board2 = (await a.get('/boards'))[0];
  await page.goto(`${S.base}/boards/${board2.id}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector(`[data-testid="col-done"] [data-testid="task-card"][data-num="${nextNum}"]`, { visible: true });
  await shot('second-card-done');

  // 主题切换（暗 → 亮）
  const themeBefore = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.click('[data-testid="btn-theme"]');
  await new Promise((r) => setTimeout(r, 300));
  const themeAfter = await page.evaluate(() => document.documentElement.dataset.theme);
  assert.notEqual(themeBefore, themeAfter);
  await shot('theme-toggled');

  // 语言切换（中 → 英）
  await page.click('[data-testid="btn-lang"]');
  await new Promise((r) => setTimeout(r, 400));
  const bodyText = await page.evaluate(() => document.body.innerText);
  assert.match(bodyText, /Boards|Task|Settings/i);
  await shot('lang-en');

  // 切回中文
  await page.click('[data-testid="btn-lang"]');
  await new Promise((r) => setTimeout(r, 400));
  await shot('lang-zh-back');
}

test('UI 人形：⌘K 命令面板（搜索/键盘导航/跳转）', async () => {
  try {
    await run3();
  } catch (e) {
    await shotFail('test3');
    throw e;
  }
});

async function run3() {
  // 确保在看板页
  const board = (await a.get('/boards'))[0];
  await page.goto(`${S.base}/boards/${board.id}`, { waitUntil: 'networkidle0' });

  // Ctrl+K 打开
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyK');
  await page.keyboard.up('Control');
  await page.waitForSelector('[data-testid="cmdk-panel"]', { visible: true });
  const itemsAll = await page.$$eval('[data-testid="cmdk-item"]', (els) => els.length);
  assert.ok(itemsAll >= 7, '面板应有动作+看板条目');

  // 搜索“设置” → 过滤到 1 条 → Enter 跳转
  await page.type('[data-testid="cmdk-input"]', '设置');
  await page.waitForFunction(() => {
    const n = document.querySelectorAll('[data-testid="cmdk-item"]').length;
    return n === 1;
  });
  await shot('cmdk-filtered');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => location.pathname === '/settings', { timeout: 5000 });
  assert.equal(page.url(), S.base + '/settings');

  // 再开面板 → ArrowDown 到“技能” → Enter
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyK');
  await page.keyboard.up('Control');
  await page.waitForSelector('[data-testid="cmdk-panel"]', { visible: true });
  await page.type('[data-testid="cmdk-input"]', '技能');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => location.pathname === '/skills', { timeout: 5000 });
  assert.equal(page.url(), S.base + '/skills');
  await shot('cmdk-nav-skills');

  // Esc 关闭
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyK');
  await page.keyboard.up('Control');
  await page.waitForSelector('[data-testid="cmdk-panel"]', { visible: true });
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(await page.evaluate(() => !!document.querySelector('[data-testid="cmdk-panel"]')), false);

  // ===== feed 筛选 / 导出 =====
  // 打开任务 1（已完成，事件最多）
  const b1 = (await a.get('/boards'))[0];
  const tasks1 = await a.get(`/boards/${b1.id}/tasks`);
  const done1 = tasks1.find((tt) => tt.status === 'done');
  assert.ok(done1, '应有已完成任务');
  await page.goto(`${S.base}/boards/${b1.id}/tasks/${done1.id}`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="ev"]').length > 0, { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 600));
  const allN = await page.$$eval('[data-testid="ev"]', (els) => els.length);
  assert.ok(allN >= 8, `完成态任务事件应较多（实际 ${allN}）`);

  // 筛选“消息” → 应少于全部（本任务无留言 → 0）
  await page.select('[data-testid="feed-filter"]', 'user');
  await new Promise((r) => setTimeout(r, 250));
  const userN = await page.$$eval('[data-testid="ev"]', (els) => els.length);
  assert.ok(userN < allN, `筛选后应减少（全部 ${allN} → 消息 ${userN}）`);
  // 筛选“验收·阻塞” → 应包含 review 行
  await page.select('[data-testid="feed-filter"]', 'review');
  await new Promise((r) => setTimeout(r, 250));
  const reviewN = await page.$$eval('[data-testid="ev"]', (els) => els.length);
  assert.ok(reviewN >= 1, '验收组至少 1 条');
  await shot('feed-filter-review');

  // 恢复全部 → 导出（应拉全量 /events?since=0）
  await page.select('[data-testid="feed-filter"]', 'all');
  let exportSeen = false;
  page.on('response', (resp) => {
    if (resp.url().includes('/events?since=0')) exportSeen = true;
  });
  await page.click('[data-testid="feed-export"]');
  await new Promise((r) => setTimeout(r, 900));
  assert.ok(exportSeen, '导出应请求全量事件');
  const expToast = await page.evaluate(() => document.querySelector('.toast')?.textContent ?? '');
  assert.ok(expToast.length > 0, '导出应有 toast');
  await shot('feed-exported');
}
