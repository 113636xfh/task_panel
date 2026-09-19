import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push('console: ' + m.type() + ' ' + m.text()));
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
page.on('requestfailed', (r) => logs.push('reqfail: ' + r.url() + ' ' + (r.failure()?.errorText ?? '')));

await page.goto('http://127.0.0.1:8787/p/demo-page-3/tasks/t-mu3y36e4-qxmimm', { waitUntil: 'networkidle2', timeout: 30000 }).catch((e) => logs.push('goto: ' + e.message));
await new Promise((r) => setTimeout(r, 3000));

const info = await page.evaluate(() => {
  const sel = (s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, h: r.height, w: r.width,
      bg: getComputedStyle(el).backgroundColor, of: getComputedStyle(el).overflowY,
      scrollH: el.scrollHeight, cls: el.className };
  };
  const feed = document.querySelector('[data-testid="feed"]');
  const evs = [...document.querySelectorAll('[data-testid="feed"] [data-testid="ev"]')].map((el) => {
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), text: el.textContent?.slice(0, 30) };
  });
  const actions = document.querySelector('.td-actions');
  return {
    root: document.querySelector('#root')?.textContent?.slice(0, 200),
    hasFeed: !!feed,
    feed: sel('[data-testid="feed"]'),
    feedLastChildren: feed ? [...feed.children].slice(-4).map((c) => ({ tag: c.tagName, cls: c.className, h: c.getBoundingClientRect().height, text: c.textContent?.slice(0, 40) })) : null,
    evCount: evs.length,
    evLast: evs.slice(-6),
    actions: actions ? { h: actions.getBoundingClientRect().height, display: getComputedStyle(actions).display, childCount: actions.children.length, bg: getComputedStyle(actions).backgroundColor, text: actions.textContent?.slice(0, 60) } : null,
    statusline: sel('[data-testid="status-line"]'),
    docH: document.documentElement.scrollHeight,
  };
});
console.log(JSON.stringify(info, null, 1));
console.log('--- logs ---');
console.log(logs.join('\n'));
await page.screenshot({ path: 'C:/Users/LittleSatellite233/AppData/Local/Temp/dbg-feed.png', fullPage: false });
await browser.close();
