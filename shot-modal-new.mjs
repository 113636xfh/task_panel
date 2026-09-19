// 截新任务弹窗：高级设置新布局（seg 整行 + 超时输入框 + 技能文件导入）
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--no-sandbox', '--window-size=1440,900'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto('http://localhost:8787/', { waitUntil: 'networkidle2' });
await page.click('[data-testid="btn-new-task"]');
await page.waitForSelector('[data-testid="input-task-title"]');
await page.type('[data-testid="input-task-title"]', 'ctx 验证任务');
await page.click('[data-testid="btn-adv-toggle"]');
await new Promise((r) => setTimeout(r, 300));
// 验证新控件存在
const checks = await page.evaluate(() => ({
  segBlock: !!document.querySelector('.seg-block'),
  branchInput: !!document.querySelector('[data-testid="input-branch-min"]'),
  filePick: !!document.querySelector('.file-pick'),
  skillListGone: !document.querySelector('.skill-list'),
}));
console.log('checks:', JSON.stringify(checks));
await page.screenshot({ path: '/tmp/shot-modal-new.png' });
await browser.close();
