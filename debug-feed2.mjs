import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ headless: 'new', executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', args: ['--no-sandbox'] });
const p = await b.newPage();
await p.setViewport({ width: 1280, height: 800 });
await p.goto('http://127.0.0.1:8787/p/demo-page-3/tasks/t-mu3y36e4-qxmimm', { waitUntil: 'networkidle0' });
await new Promise(r => setTimeout(r, 2500));
const out = await p.evaluate(() => {
  const z = getComputedStyle(document.getElementById('root')).zoom;
  const feed = document.querySelector('[data-testid="feed"]');
  const par = feed.parentElement;
  const pr = par.getBoundingClientRect();
  const kids = [...par.children].map((c) => {
    const r = c.getBoundingClientRect();
    const cs = getComputedStyle(c);
    return { cls: c.className, top: Math.round(r.top), h: Math.round(r.height), display: cs.display, flex: cs.flex, of: cs.overflow, maxH: cs.maxHeight };
  });
  const parCs = getComputedStyle(par);
  return {
    zoom: z,
    parent: { cls: par.className, top: Math.round(pr.top), h: Math.round(pr.height), display: parCs.display, flexDir: parCs.flexDirection, of: parCs.overflow },
    kids,
  };
});
console.log(JSON.stringify(out, null, 1));
await b.close();
