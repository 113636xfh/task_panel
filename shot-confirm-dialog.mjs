// 验证：取消/删除任务均先弹确认框
import puppeteer from 'puppeteer-core';
import { DatabaseSync } from 'node:sqlite';

const B = 'http://localhost:8787/api';
const created = await (await fetch(B + '/tasks', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ title: '确认框验证', description: '无操作，仅用于 UI 验证。', priority: 2, workspace: { mode: 'fresh', name: 'confirm-verify' } }),
})).json();
const ID = created.id;

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--no-sandbox', '--window-size=1440,900'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto(`http://localhost:8787/p/confirm-verify/tasks/${ID}`, { waitUntil: 'networkidle2' });
await new Promise((r) => setTimeout(r, 1200));

// 1) 取消任务 → 弹框 → 点「取消」关闭（状态不变）
await page.click('button:has-text("取消任务")').catch(async () => {
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => b.textContent.includes('取消任务'))?.click();
  });
});
await new Promise((r) => setTimeout(r, 400));
const cancelDialog = await page.$eval('[data-testid="confirm-dialog"]', (el) => el.textContent).catch(() => null);
console.log('cancelDialog:', JSON.stringify(cancelDialog));
await page.screenshot({ path: '/tmp/shot-confirm-cancel.png' });
// 点取消（第一个按钮 = 取消）
await page.evaluate(() => {
  const d = document.querySelector('[data-testid="confirm-dialog"]');
  d.querySelectorAll('.m-f button')[0].click();
});
await new Promise((r) => setTimeout(r, 400));
const dialogGone = await page.$('[data-testid="confirm-dialog"]').catch(() => null);

// 2) 删除任务 → 弹框 → 点确认
await page.evaluate(() => {
  document.querySelector('[data-testid="btn-delete"]').click();
});
await new Promise((r) => setTimeout(r, 400));
const delDialog = await page.$eval('[data-testid="confirm-dialog"]', (el) => el.textContent).catch(() => null);
console.log('delDialog:', JSON.stringify(delDialog));
await page.screenshot({ path: '/tmp/shot-confirm-delete.png' });
await page.click('[data-testid="confirm-ok"]');
await new Promise((r) => setTimeout(r, 1000));
const afterUrl = page.url();
const db = new DatabaseSync('./data/taskpanel.db', { readOnly: true });
const gone = !db.prepare('SELECT id FROM tasks WHERE id=?').get(ID);
console.log(JSON.stringify({ dialogGone: !!dialogGone, afterUrl, gone }));
await browser.close();
console.log(gone && !dialogGone ? 'ALL_OK' : 'CHECK');
