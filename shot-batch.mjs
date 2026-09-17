import puppeteer from 'puppeteer-core';
const EXE = process.env.TP_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const base = 'http://127.0.0.1:8787';
const browser = await puppeteer.launch({ executablePath: EXE, headless: true, args: ['--no-sandbox', '--window-size=1440,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const out = process.argv[2] || 'C:/Users/LittleSatellite233/AppData/Local/Temp';

// 1) 项目看板（行布局）
await page.goto(base + '/p/demo-auth-1', { waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 600));
await page.screenshot({ path: out + '/b-row-board.png' });

// 2) 任务详情（2 行头 + 侧栏确认卡）
await page.goto(base + '/p/demo-auth-1/tasks/t-mu3y36dq-zo4qqe', { waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 1200));
await page.screenshot({ path: out + '/b-row-detail.png' });

// 3) 首页看板
await page.goto(base + '/boards', { waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 600));
await page.screenshot({ path: out + '/b-row-home.png' });

await browser.close();
console.log('done');
