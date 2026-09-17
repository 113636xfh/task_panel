// 临时：full 模式 TUI 渲染截图
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { ROOT, startServer, makeApi } from './helpers.mjs';

const PORT = 18910;
const S = await startServer({ port: PORT });
const a = makeApi(S.base + '/api');

// 建一个普通任务（stub 很快跑完，产生 thinking + toolCall + toolResult）
const { id } = await a.post('/tasks', {
  title: 'TUI 渲染检查',
  description: '验证 full 模式渲染。',
  workspace: { mode: 'fresh', name: 'tui-check' },
});
await a.post(`/tasks/${id}/start`);
const t0 = Date.now();
for (;;) {
  const t = await a.get(`/tasks/${id}`);
  if (['done', 'failed', 'cancelled', 'awaiting_confirm'].includes(t.status)) break;
  if (Date.now() - t0 > 30_000) throw new Error('timeout');
  await new Promise((r) => setTimeout(r, 400));
}

const cands = [
  path.join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].filter(Boolean);
const exe = cands.find((c) => fs.existsSync(c));
const browser = await puppeteer.launch({ executablePath: exe, headless: true, args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto(`${S.base}/p/${encodeURIComponent('tui-check')}/tasks/${id}`, { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 800));
// 切到 full 模式
await page.select('[data-testid="feed-filter"]', 'full');
await new Promise((r) => setTimeout(r, 900));
await page.evaluate(() => { const f = document.querySelector('[data-testid="feed"]'); if (f) f.scrollTop = 0; });
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: 'test/ui-artifacts/90-full-mode.png' });
await page.evaluate(() => { const f = document.querySelector('[data-testid="feed"]'); if (f) f.scrollTop = f.scrollHeight * 0.55; });
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: 'test/ui-artifacts/90-full-mode2.png' });
await browser.close();
await S.stop();
console.log('ok');
