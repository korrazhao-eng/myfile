#!/usr/bin/env node
'use strict';
/* =============================================================================
 * 差分测试：新后端（server/，Node+Express+SQLite） vs 旧模拟后端（serve.py）
 *
 * 目的：验证「新后端完全兼容旧接口契约」——这是「前端零改动」的前提。
 * 做法：对同一串请求逐条比较「状态码 + 响应体」，两个后端跑**隔离数据**互不干扰。
 *
 * 用法：
 *   node tests/difftest.js                # 自动拉起两个后端（隔离端口/库），结束自动清理
 *   NEW=http://127.0.0.1:8080 OLD=http://127.0.0.1:8787 node tests/difftest.js
 *                                           # 对已在运行的服务做差分（需自行保证数据可写）
 *
 * 退出码：0 = 全部一致；1 = 存在不一致；2 = 后端未就绪
 * ============================================================================= */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');          // gym-app 根目录
const NEW = process.env.NEW || '';
const OLD = process.env.OLD || '';
const NEW_PORT = Number(process.env.NEW_PORT || 18080);
const OLD_PORT = Number(process.env.OLD_PORT || 18787);

const ID_RE = /"id"\s*:\s*"[0-9a-f]{8}"/g;
/* 归一化：① 8 位随机 id → 占位符；② JSON 空白差异（Python dumps 带空格 / Node 紧凑）→ 统一紧凑格式 */
const norm = (s) => {
  const t = String(s).replace(ID_RE, '"id":"<ID8>"');
  try { return JSON.stringify(JSON.parse(t)); } catch (e) { return t; }
};

/* ---------------------------------------------------------------------------
 * 向后兼容扩展白名单
 * 新后端允许比旧 serve.py 多返回这些顶层键（契约 V2.1 新增集合，serve.py 无对应实现）。
 * 判定规则：旧响应里的每个键必须在新响应中**存在且逐字节一致**；新响应多出来的键允许存在。
 * 这样既保证「旧契约字段零回归」，又允许新契约的向前扩展。
 * ------------------------------------------------------------------------- */
const EXTRA_TOP_KEYS_ALLOWED = ['mappings'];

function compareBodies(oldText, newText) {
  const o = JSON.parse(oldText);
  const n = JSON.parse(newText);
  if (!o || typeof o !== 'object' || Array.isArray(o) || !n || typeof n !== 'object' || Array.isArray(n)) {
    /* 非对象响应（数组 / 标量）→ 直接整体比较 */
    return { same: o === n, detail: '' };
  }
  for (const k of Object.keys(o)) {
    if (!(k in n)) {
      return { same: false, detail: `旧响应的键 "${k}" 在新响应中缺失` };
    }
    if (JSON.stringify(o[k]) !== JSON.stringify(n[k])) {
      return { same: false, detail: `键 "${k}" 内容不一致` };
    }
  }
  const extra = Object.keys(n).filter((k) => !(k in o));
  const badExtra = extra.filter((k) => !EXTRA_TOP_KEYS_ALLOWED.includes(k));
  if (badExtra.length) {
    return { same: false, detail: `新响应出现未登记的新增键：${badExtra.join(', ')}` };
  }
  return { same: true, detail: extra.length ? `（新响应额外含向后兼容键：${extra.join(', ')}）` : '' };
}

async function hit(base, method, p, body) {
  const opt = { method, headers: {} };
  if (body !== undefined) {
    opt.headers['Content-Type'] = 'application/json';
    opt.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const r = await fetch(base + p, opt);
  const text = await r.text();
  const ct = r.headers.get('content-type') || '';
  let json = null;
  if (ct.includes('json')) { try { json = JSON.parse(text); } catch (e) { json = null; } }
  return { status: r.status, text, json, ct };
}

const state = { new: {}, old: {} };

/* 步骤表：p / b 可为 (st)=>... 形式，各自拿到该后端自己的上下文（如新建记录的 id） */
const steps = [
  // ---------------- 读接口 ----------------
  { n: 'GET /api/bootstrap', m: 'GET', p: '/api/bootstrap' },
  { n: 'GET /api/coaches', m: 'GET', p: '/api/coaches' },
  { n: 'GET /api/equipments', m: 'GET', p: '/api/equipments' },
  { n: 'GET /api/users', m: 'GET', p: '/api/users' },
  { n: 'GET /api/profile', m: 'GET', p: '/api/profile' },
  { n: 'GET /api/plans', m: 'GET', p: '/api/plans' },
  { n: 'GET /api/logs', m: 'GET', p: '/api/logs' },
  { n: 'GET /api/lessons', m: 'GET', p: '/api/lessons' },
  { n: 'GET /api/logs?date=', m: 'GET', p: '/api/logs?date=2026-10-27' },
  { n: 'GET /api/logs?date= 无匹配', m: 'GET', p: '/api/logs?date=2099-01-01' },
  { n: 'GET /api/lessons?coach=', m: 'GET', p: '/api/lessons?coach=' + encodeURIComponent('曹操') },
  { n: 'GET /api/lessons?date=&coach= 叠加', m: 'GET', p: '/api/lessons?date=2026-10-22&coach=' + encodeURIComponent('曹操') },
  { n: 'GET /api/lessons?coach= 不存在', m: 'GET', p: '/api/lessons?coach=' + encodeURIComponent('不存在') },
  { n: 'GET /api/coaches/c1', m: 'GET', p: '/api/coaches/c1' },
  { n: 'GET /api/coaches/nope → 404', m: 'GET', p: '/api/coaches/nope' },
  { n: 'GET /api/plans/back', m: 'GET', p: '/api/plans/back' },
  { n: 'GET /api/profile/xxx (profile 无 id) → 404', m: 'GET', p: '/api/profile/xxx' },
  { n: 'GET /api/logs/xxx (logs 返回数组)', m: 'GET', p: '/api/logs/xxx' },
  { n: 'GET /api/unknown → 404', m: 'GET', p: '/api/unknown' },
  { n: 'GET /api/coaches/ → 尾斜杠', m: 'GET', p: '/api/coaches/' },

  // ---------------- coaches 增删改查 ----------------
  { n: 'POST /api/coaches 缺 name → 400', m: 'POST', p: '/api/coaches', b: { course: 'x' } },
  { n: 'POST /api/coaches 空 name → 400', m: 'POST', p: '/api/coaches', b: { name: '' } },
  { n: 'POST /api/coaches 新增', m: 'POST', p: '/api/coaches', b: { name: '新教练', course: '体能课', tags: ['NSCA'] }, save: 'coachId' },
  { n: 'GET 新教练 (查)', m: 'GET', p: (st) => '/api/coaches/' + st.coachId },
  { n: 'PUT /api/coaches/:id 合并更新', m: 'PUT', p: (st) => '/api/coaches/' + st.coachId, b: (st) => ({ course: '改过的课' }) },
  { n: 'PUT /api/coaches/:id body 带 id 被忽略', m: 'PUT', p: (st) => '/api/coaches/' + st.coachId, b: () => ({ id: 'hacked', name: '改名了' }) },
  { n: 'GET 教练 (改后)', m: 'GET', p: (st) => '/api/coaches/' + st.coachId },
  { n: 'PUT /api/coaches/nope → 404', m: 'PUT', p: '/api/coaches/nope', b: { course: 'x' } },
  { n: 'PUT /api/coaches (缺 id) → 405', m: 'PUT', p: '/api/coaches', b: { course: 'x' } },
  { n: 'PUT /api/coaches/:id 非法 JSON → 400', m: 'PUT', p: (st) => '/api/coaches/' + st.coachId, b: '{invalid' },
  { n: 'DELETE /api/coaches/:id (删)', m: 'DELETE', p: (st) => '/api/coaches/' + st.coachId },
  { n: 'DELETE /api/coaches/:id 再删 → 404', m: 'DELETE', p: (st) => '/api/coaches/' + st.coachId },
  { n: 'DELETE /api/coaches (缺 id) → 405', m: 'DELETE', p: '/api/coaches' },

  // ---------------- equipments ----------------
  { n: 'POST /api/equipments 缺 name → 400', m: 'POST', p: '/api/equipments', b: { type: '胸部' } },
  { n: 'POST /api/equipments 新增', m: 'POST', p: '/api/equipments', b: { type: '背部', name: '测试器械', videoUrl: 'u', videoJump: 'j', safety: 's', muscles: ['背阔肌'], subMuscles: ['肱二头肌'] }, save: 'eqId' },
  { n: 'GET 新器械 (查)', m: 'GET', p: (st) => '/api/equipments/' + st.eqId },
  { n: 'PUT /api/equipments/:id', m: 'PUT', p: (st) => '/api/equipments/' + st.eqId, b: { muscles: ['背阔肌', '菱形肌'] } },
  { n: 'GET 器械 (改后)', m: 'GET', p: (st) => '/api/equipments/' + st.eqId },
  { n: 'DELETE /api/equipments/:id (删)', m: 'DELETE', p: (st) => '/api/equipments/' + st.eqId },
  { n: 'GET 器械 (删后) → 404', m: 'GET', p: (st) => '/api/equipments/' + st.eqId },

  // ---------------- users ----------------
  { n: 'POST /api/users 新增', m: 'POST', p: '/api/users', b: { nickname: '新用户', phone: '13800000000' }, save: 'userId' },
  { n: 'GET 新用户 (查)', m: 'GET', p: (st) => '/api/users/' + st.userId },
  { n: 'PUT /api/users/:id', m: 'PUT', p: (st) => '/api/users/' + st.userId, b: { heart: 66 } },
  { n: 'GET 用户 (改后)', m: 'GET', p: (st) => '/api/users/' + st.userId },
  { n: 'DELETE /api/users/:id (删)', m: 'DELETE', p: (st) => '/api/users/' + st.userId },

  // ---------------- logs：按 date upsert ----------------
  { n: 'POST /api/logs 新增', m: 'POST', p: '/api/logs', b: { date: '2026-12-01', type: 'solo', records: [{ action: '深蹲', sets: 4, weight: 50 }] } },
  { n: 'POST /api/logs 同日再提交 → 覆盖不追加', m: 'POST', p: '/api/logs', b: { date: '2026-12-01', type: 'solo', records: [{ action: '卧推', sets: 3, weight: 30 }] } },
  { n: 'GET /api/logs?date=2026-12-01 (查)', m: 'GET', p: '/api/logs?date=2026-12-01' },
  { n: 'GET /api/logs (查·upsert 后只有 1 条)', m: 'GET', p: '/api/logs' },
  { n: 'POST /api/logs 无 date → 普通追加', m: 'POST', p: '/api/logs', b: { type: 'solo', records: [] }, save: 'logId' },

  // ---------------- lessons：按 date upsert ----------------
  { n: 'POST /api/lessons 新增', m: 'POST', p: '/api/lessons', b: { date: '2026-12-02', coachName: '田文镜', course: '力量训练课', createdAt: 1700000000000 } },
  { n: 'POST /api/lessons 同日换教练 → 覆盖', m: 'POST', p: '/api/lessons', b: { date: '2026-12-02', coachName: '曹操', course: '体能提升课', createdAt: 1700000000001 } },
  { n: 'GET /api/lessons?date=2026-12-02 (查)', m: 'GET', p: '/api/lessons?date=2026-12-02' },
  { n: 'GET /api/lessons?coach=曹操', m: 'GET', p: '/api/lessons?coach=' + encodeURIComponent('曹操') },

  // ---------------- profile / plans：仅 PUT 全量 ----------------
  { n: 'POST /api/profile → 405', m: 'POST', p: '/api/profile', b: [] },
  { n: 'DELETE /api/profile → 405', m: 'DELETE', p: '/api/profile' },
  { n: 'PUT /api/profile 非数组 → 405', m: 'PUT', p: '/api/profile', b: { a: 1 } },
  { n: 'PUT /api/profile 全量替换', m: 'PUT', p: '/api/profile', b: [{ title: '心率记录', main: '最近一次 80 次/分', sub: '记录日期 2026-12-01' }] },
  { n: 'GET /api/profile (替换后)', m: 'GET', p: '/api/profile' },
  { n: 'POST /api/plans → 405', m: 'POST', p: '/api/plans', b: [] },
  { n: 'DELETE /api/plans → 405', m: 'DELETE', p: '/api/plans' },
  { n: 'PUT /api/plans 非数组 → 405', m: 'PUT', p: '/api/plans', b: { a: 1 } },
  { n: 'PUT /api/plans 全量替换', m: 'PUT', p: '/api/plans', b: [{ id: 'back', part: '背', warmup: { targets: 'x', method: 'y', standard: 'z' }, steps: [], stretch: [] }] },
  { n: 'GET /api/plans (替换后)', m: 'GET', p: '/api/plans' },
  { n: 'GET /api/bootstrap (profile 已替换)', m: 'GET', p: '/api/bootstrap' },

  // ---------------- 错误格式 ----------------
  { n: 'POST /api/coaches 非法 JSON → 400', m: 'POST', p: '/api/coaches', b: '{invalid' },
  { n: 'POST /api/coaches 空 body → 400', m: 'POST', p: '/api/coaches' },
  { n: 'POST /api/unknown → 404', m: 'POST', p: '/api/unknown', b: { name: 'x' } },
  { n: 'PUT /api/unknown → 404', m: 'PUT', p: '/api/unknown', b: { name: 'x' } },
  { n: 'DELETE /api/unknown → 404', m: 'DELETE', p: '/api/unknown' },
];

/* ---------------- 拉起两个后端（隔离数据） ---------------- */
const children = [];
const tmpDirs = [];

function cleanup() {
  children.forEach((c) => { try { c.kill('SIGTERM'); } catch (e) {} });
  tmpDirs.forEach((d) => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {} });
}

async function waitUp(base, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(base + '/api/coaches');
      if (r.ok) return true;
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

async function startNew() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-diff-new-'));
  tmpDirs.push(dir);
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'src', 'index.js')], {
    env: { ...process.env, PORT: String(NEW_PORT), DB_PATH: path.join(dir, 'gym.db'), ADMIN_TOKEN: '' },
    stdio: 'ignore',
  });
  children.push(child);
  return `http://127.0.0.1:${NEW_PORT}`;
}

async function startOld() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-diff-old-'));
  tmpDirs.push(dir);
  /* serve.py 把数据写在自己 ROOT/data 下，无法通过参数改目录；
     为避免污染仓库里的 data/，复制一份 serve.py + data/ 到临时目录再启动。 */
  fs.copyFileSync(path.join(ROOT, 'serve.py'), path.join(dir, 'serve.py'));
  fs.cpSync(path.join(ROOT, 'data'), path.join(dir, 'data'), { recursive: true });
  const child = spawn('python3', [path.join(dir, 'serve.py'), String(OLD_PORT)], { stdio: 'ignore' });
  children.push(child);
  return `http://127.0.0.1:${OLD_PORT}`;
}

(async () => {
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(130); });

  const newBase = NEW || await startNew();
  const oldBase = OLD || await startOld();

  const okNew = await waitUp(newBase);
  const okOld = await waitUp(oldBase);
  if (!okNew || !okOld) {
    console.error(`后端未就绪：new=${okNew} old=${okOld}`);
    console.error(`  new: ${newBase}\n  old: ${oldBase}`);
    cleanup();
    process.exit(2);
  }

  console.log(`差分测试：new=${newBase}  old=${oldBase}\n`);
  let pass = 0, fail = 0;
  const failures = [];
  for (const s of steps) {
    const bodyFor = (st) => (typeof s.b === 'function' ? s.b(st) : s.b);
    const pathFor = (st) => (typeof s.p === 'function' ? s.p(st) : s.p);
    const [a, b] = [state.new, state.old];
    const ra = await hit(newBase, s.m, pathFor(a), bodyFor(a));
    const rb = await hit(oldBase, s.m, pathFor(b), bodyFor(b));
    if (s.save && ra.json && ra.json.id) a[s.save] = ra.json.id;
    if (s.save && rb.json && rb.json.id) b[s.save] = rb.json.id;

    const na = norm(ra.text), nb = norm(rb.text);
    let bodySame = na === nb;
    let detail = '';
    if (!bodySame) {
      /* 状态码相同才做「旧键必须一致」的结构化比较；状态码不同直接判不一致 */
      if (ra.status === rb.status) {
        const cmp = compareBodies(rb.text, ra.text);
        bodySame = cmp.same;
        detail = cmp.detail;
      }
    }
    if (ra.status === rb.status && bodySame) {
      pass++;
      console.log(`  ✓ ${s.n}  [${ra.status}]${detail ? ' ' + detail : ''}`);
    } else {
      fail++;
      failures.push({ step: s.n, newStatus: ra.status, oldStatus: rb.status, reason: detail || '响应体不一致', newBody: na.slice(0, 400), oldBody: nb.slice(0, 400) });
      console.log(`  ✗ ${s.n}\n      new(${ra.status}): ${na.slice(0, 300)}\n      old(${rb.status}): ${nb.slice(0, 300)}${detail ? '\n      原因: ' + detail : ''}`);
    }
  }
  console.log(`\n差分结果：${pass} 通过 / ${fail} 不一致（共 ${steps.length} 步）`);
  if (failures.length) {
    console.log('\n不一致明细：');
    failures.forEach((f) => console.log(JSON.stringify(f, null, 2)));
  }
  cleanup();
  process.exit(fail ? 1 : 0);
})();
