import puppeteer from 'puppeteer-core';
const EXE = process.env.TP_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const base = 'http://127.0.0.1:8787';
const out = 'C:/Users/LittleSatellite233/AppData/Local/Temp';
const browser = await puppeteer.launch({ executablePath: EXE, headless: true });

async function shot(w, h, path, name, fullPage = false) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h });
  await page.goto(base + path, { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 900));
  const z = await page.evaluate(() => document.documentElement.style.getPropertyValue('--app-zoom'));
  const scrolled = await page.evaluate(() => document.scrollingElement.scrollHeight - window.innerHeight);
  await page.screenshot({ path: out + name, fullPage });
  console.log(name, 'zoom=', z, 'page-overflow=', scrolled);
  await page.close();
}

// 1) 设置页 @1440×900（M 档，zoom 应为 1）
await shot(1440, 900, '/settings', '/s-settings-1440.png', true);
// 2) 设置页 @1920×1080（自适应 zoom 1.2，页面不溢出；fullPage 看流式大块）
await shot(1920, 1080, '/settings', '/s-settings-1920.png', true);
// 3) 首页看板 @1920×1080
await shot(1920, 1080, '/boards', '/s-home-1920.png');
// 4) 任务详情 @1440×900
await shot(1440, 900, '/p/demo-deploy-4/tasks/t-mu3yomq3-ghgo56', '/s-detail-1440.png');

await browser.close();
console.log('done');
