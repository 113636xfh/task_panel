// 验证：实时流期间用户上滑看历史 → 不被强拉到底；滚回底部 → 恢复跟随
import puppeteer from 'puppeteer-core';

const ID = 't-mu8j7a3y-dk59g2';
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--no-sandbox', '--window-size=1440,900'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto(`http://localhost:8787/p/scroll-verify/tasks/${ID}`, { waitUntil: 'networkidle2' });

// 等实时思维流出现
let liveSeen = false;
for (let i = 0; i < 90; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  liveSeen = await page.evaluate(() => !!document.querySelector('.live-stream'));
  if (liveSeen) break;
}
console.log('liveSeen:', liveSeen);
if (!liveSeen) process.exit(1);

await new Promise((r) => setTimeout(r, 5000)); // 让流长一点
const feed = (await page.$('[data-testid="feed"]'));

// 上滑到顶部
await page.evaluate((el) => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')); }, feed);
await new Promise((r) => setTimeout(r, 500));
const top1 = await page.evaluate((el) => el.scrollTop, feed);
// 流式期间等 15s：若被强拉，scrollTop 会接近 scrollHeight
await new Promise((r) => setTimeout(r, 15000));
const top2 = await page.evaluate((el) => ({ st: el.scrollTop, sh: el.scrollHeight, ch: el.clientHeight }), feed);
const stayedUp = top2.st < 200;
console.log('stayedUp:', JSON.stringify({ top1, ...top2, stayedUp }));

// 滚回底部 → 恢复跟随
await page.evaluate((el) => { el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event('scroll')); }, feed);
await new Promise((r) => setTimeout(r, 8000));
const bottom = await page.evaluate((el) => ({ st: el.scrollTop, sh: el.scrollHeight, ch: el.clientHeight }), feed);
const nearBottom = bottom.sh - bottom.st - bottom.ch < 120;
console.log('followAgain:', JSON.stringify({ ...bottom, nearBottom }));

await browser.close();
console.log(stayedUp && nearBottom ? 'ALL_OK' : 'CHECK');
