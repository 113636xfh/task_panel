// 验证：状态条上下文块 / 思维框 brain 图标 / 返回原页面 / 删除任务
import puppeteer from 'puppeteer-core';
import { DatabaseSync } from 'node:sqlite';

const ID = 't-mu8fxau6-8bmpy7';
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--no-sandbox', '--window-size=1440,900'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

// 1) 状态条 + 思维框
await page.goto(`http://localhost:8787/p/ctx-verify/tasks/${ID}`, { waitUntil: 'networkidle2' });
await new Promise((r) => setTimeout(r, 2500));
const detail = await page.evaluate(() => ({
  ctxChip: document.querySelector('.sl-ctx')?.textContent?.trim() ?? null,
  ctxHot: document.querySelector('.sl-ctx')?.className ?? null,
  comp: document.querySelector('.sl-comp')?.textContent ?? null,
  thinkBlocks: document.querySelectorAll('.ev-think').length,
  thinkLabelGone: ![...document.querySelectorAll('.ev-think .ev-think-label')].some((el) => el.textContent.trim() !== ''),
  thinkIco: document.querySelectorAll('.ev-think .ev-ico').length,
}));
console.log('detail:', JSON.stringify(detail));
await page.screenshot({ path: '/tmp/shot-statusline.png' });

// 2) 从项目看板进任务 → 返回 → 应回项目看板
await page.goto('http://localhost:8787/p/ctx-verify', { waitUntil: 'networkidle2' });
await new Promise((r) => setTimeout(r, 800));
const row = await page.$(`[data-testid="task-row"]`);
if (row) await row.click();
await page.waitForSelector(`[data-testid="status-badge"]`);
const backBtn = await page.$('.td-head .btn.ghost');
await backBtn.click();
await new Promise((r) => setTimeout(r, 800));
const backUrl = page.url();
console.log('backUrl:', backUrl, backUrl.includes('/p/ctx-verify') ? 'OK' : 'FAIL');

// 3) 删除任务（两步确认）
await page.goto(`http://localhost:8787/p/ctx-verify/tasks/${ID}`, { waitUntil: 'networkidle2' });
await new Promise((r) => setTimeout(r, 800));
await page.click('[data-testid="btn-delete"]');
await new Promise((r) => setTimeout(r, 400));
const confirmText = await page.$eval('[data-testid="btn-delete"]', (b) => b.textContent.trim());
await page.click('[data-testid="btn-delete"]');
await new Promise((r) => setTimeout(r, 1200));
const afterUrl = page.url();
const db = new DatabaseSync('./data/taskpanel.db', { readOnly: true });
const gone = !db.prepare('SELECT id FROM tasks WHERE id=?').get(ID);
console.log('delete:', JSON.stringify({ confirmText, afterUrl, gone }));

await browser.close();
