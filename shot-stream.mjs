import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ headless: 'new', executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 900 });
await p.goto('http://127.0.0.1:8787/p/str-mqk9z8j/tasks/t-mu8c670e-5mmrr8', { waitUntil: 'networkidle2' }).catch(() => {});
await p.waitForSelector('[data-testid="feed"]', { timeout: 15000 });
await new Promise(r => setTimeout(r, 1500));
const info = await p.evaluate(() => {
  const details = document.querySelector('details.ev-think');
  return { thinkDetails: !!details, summaryText: details?.querySelector('summary')?.textContent?.slice(0, 60) };
});
await p.screenshot({ path: 'C:/tmp/shot-stream-summary.png' });
// full 模式
await p.select('[data-testid="feed-filter"]', 'full').catch(() => {});
await new Promise(r => setTimeout(r, 800));
const thinkBlocks = await p.evaluate(() => document.querySelectorAll('[data-testid="think-block"]').length);
await p.screenshot({ path: 'C:/tmp/shot-stream-full.png' });
console.log(JSON.stringify({ info, thinkBlocks }));
await b.close();
