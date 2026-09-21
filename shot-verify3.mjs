// 验证：markdown 表格 / 工具调用结果 / 产物栏 / done 后 chat 提问
import puppeteer from 'puppeteer-core';

const ID = 't-mu89iyl3-38bco9';
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--no-sandbox', '--window-size=1440,900'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto(`http://localhost:8787/p/test/tasks/${ID}`, { waitUntil: 'networkidle2' });
await new Promise((r) => setTimeout(r, 2500));

// 1) 表格
const table = await page.$('.md-table');
console.log('table:', !!table);
if (table) {
  await page.evaluate((el) => el.scrollIntoView({ block: 'center' }), table);
  await new Promise((r) => setTimeout(r, 300));
  await page.screenshot({ path: '/tmp/shot-table.png' });
}

// 2) 工具结果
const toolres = await page.$$('.ev-toolres');
console.log('toolres rows:', toolres.length);
if (toolres.length) {
  await page.evaluate((el) => el.scrollIntoView({ block: 'center' }), toolres[0]);
  await new Promise((r) => setTimeout(r, 300));
  await page.screenshot({ path: '/tmp/shot-toolres.png' });
}

// 3) 产物栏
const assets = await page.evaluate(() => {
  const tab = [...document.querySelectorAll('.tab')].find((x) => x.textContent.includes('产物'));
  tab?.click();
  return true;
});
await new Promise((r) => setTimeout(r, 800));
const assetItems = await page.evaluate(() => {
  const side = document.querySelector('.td-side');
  const rows = [...(side?.querySelectorAll('[data-asset], .asset-item, .asset-row, li, .side-file') ?? [])].map((x) => x.textContent.trim().slice(0, 40));
  return rows.slice(0, 15);
});
console.log('assets:', JSON.stringify(assetItems));
await page.screenshot({ path: '/tmp/shot-assets.png' });

// 4) chat：发消息提问
const before = await page.evaluate(() => document.querySelector('[data-testid="feed"]').innerText.length);
await page.type('[data-testid="input-msg-short"]', '你好，这个动画的车轮动画周期是多少秒？请只回答数字和简短说明。');
await page.click('[data-testid="btn-msg-send-short"]');
console.log('chat sent, waiting for reply...');
let replied = false;
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  const now = await page.evaluate(() => document.querySelector('[data-testid="feed"]').innerText.length);
  const sys = await page.evaluate(() => document.querySelector('[data-testid="feed"]').innerText.includes('回复：'));
  if (sys && now > before + 20) { replied = true; break; }
}
console.log('replied:', replied);
await page.evaluate(() => {
  const f = document.querySelector('[data-testid="feed"]');
  if (f && (f.scrollHeight - f.scrollTop - f.clientHeight > 400)) f.scrollTop = f.scrollHeight;
});
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: '/tmp/shot-chat.png' });
await browser.close();
