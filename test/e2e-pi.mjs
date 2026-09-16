// e2e 冒烟：真实 pi 执行器 + 真实模型服务（可选、慢）。
// 运行: npm run test:e2e
// 前提：pi 已登录；vLLM 模型服务在线（默认 192.168.2.15:8080，见设置页）。
// 模型服务不可达时自动跳过（exit 0），不阻塞 CI/日常回归。
import fs from 'node:fs';
import path from 'node:path';
import { startServer, makeApi, waitForStatus } from './helpers.mjs';

const PORT = 18804;
const MODELS_URL = 'http://192.168.2.15:8080/v1/models';
const TASK_TIMEOUT = 15 * 60_000; // 真实执行可能较慢

async function modelUp() {
  try {
    const r = await fetch(MODELS_URL, { signal: AbortSignal.timeout(4000) });
    const j = await r.json();
    return r.ok && Array.isArray(j.data) && j.data.length > 0;
  } catch {
    return false;
  }
}

(async () => {
  console.log('检查模型服务…', MODELS_URL);
  if (!(await modelUp())) {
    console.log('⚠ 模型服务不可达，跳过 e2e（日常回归用 npm test / npm run test:ui 即可）');
    process.exit(0);
  }

  const S = await startServer({ port: PORT, executor: 'pi' });
  const a = makeApi(S.base + '/api');
  let failed = false;
  try {
    const b = await a.post('/boards', { name: 'e2e 冒烟' });
    const t = await a.post(`/boards/${b.id}/tasks`, {
      title: 'e2e 冒烟：创建 hello.txt',
      description: '在当前工作区根目录创建 hello.txt，文件内容为一行：hello world（小写，含空格，无额外内容）。',
      workspace: { mode: 'fresh', name: 'e2e-smoke' },
      acceptance: '工作区根目录存在 hello.txt，内容为 hello world',
      test_cmd: 'node -e "const s=require(\'fs\').existsSync(\'hello.txt\')?require(\'fs\').readFileSync(\'hello.txt\',\'utf8\').trim():null;process.exit(s===\'hello world\'?0:1)"',
      branch_mode: 'auto',
    });
    console.log('任务已创建，等待真实 pi 完成（规划→执行→测试→验收），最长 15 分钟…');
    const done = await waitForStatus(S.base, t.id, 'awaiting_confirm', TASK_TIMEOUT);
    console.log('达到待确认：', done.status, 'review.overall =', done.review?.overall);
    if (done.review?.overall !== 'pass') throw new Error('验收未通过（e2e 冒烟任务应 pass）');

    // 交付物落盘检查
    const file = path.join(done.workspace_path, 'hello.txt');
    if (!fs.existsSync(file)) throw new Error(`交付物缺失: ${file}`);
    console.log('交付物存在:', file, '→', JSON.stringify(fs.readFileSync(file, 'utf8').trim()));

    await a.post(`/tasks/${t.id}/confirm`);
    const fin = await a.get(`/tasks/${t.id}`);
    if (fin.status !== 'done') throw new Error(`确认后状态异常: ${fin.status}`);
    console.log('✔ e2e 冒烟通过：真实 pi 全流程（规划/执行/测试/验收/确认/交付物）');
  } catch (e) {
    failed = true;
    console.error('✖ e2e 冒烟失败:', e.message);
  } finally {
    await S.stop();
  }
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('e2e 异常:', e);
  process.exit(1);
});
