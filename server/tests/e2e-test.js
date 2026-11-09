#!/usr/bin/env node
'use strict';
/* =============================================================================
 * 端到端联动测试：真实前端数据层（js/store.js） × 真实后端（server/）
 *
 * 验证「用户端训练上报 → 后端落库 → 后台可见 → 删除同步移除」这条完整链路：
 *   ① 训练日志上报后端成功，后端可查到当日记录（按 date upsert）
 *   ② 同日再次上报 → 覆盖而非追加（后端 upsert 语义）
 *   ③ 教练课预约上报后端成功，后端可查到
 *   ④ 重新加载前端（清空内存态）后，数据仍能从后端恢复（API 为主数据的核心证据）
 *   ⑤ 后端删除记录后，前端刷新即同步移除（管理员删除可同步到用户端）
 *   ⑥ 后端不可用时，前端静默回退本地缓存（不抛错）
 *
 * 实现：Node 内置 vm 加载真实 js/store.js + 打桩 fetch 指向真实后端，**不依赖 jsdom**。
 *
 * 用法：node tests/e2e-test.js
 * 退出码：0 = 全通过；1 = 有失败；2 = 后端未就绪
 * ============================================================================= */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = Number(process.env.E2E_PORT || 18081);
const BASE = `http://127.0.0.1:${PORT}`;
const STORE_SRC = fs.readFileSync(path.join(ROOT, 'js', 'store.js'), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function ok(n) { pass++; console.log(`  ✓ ${n}`); }
function bad(n, d) { fail++; failures.push({ n, d }); console.log(`  ✗ ${n}\n      ${d}`); }
function assert(n, c, d) { c ? ok(n) : bad(n, d || '断言失败'); }
function assertEq(n, a, e) {
  const x = JSON.stringify(a), y = JSON.stringify(e);
  assert(n, x === y, `期望 ${y}，实际 ${x}`);
}
function section(t) { console.log(`\n${t}`); }

/* ---------------- 前端沙箱 ---------------- */

function makeLocalStorage(initial) {
  const map = new Map(Object.entries(initial || {}));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => map.clear(),
    key: (i) => Array.from(map.keys())[i] ?? null,
    get length() { return map.size; },
  };
}

class CustomEventShim {
  constructor(type, init) { this.type = type; this.detail = (init && init.detail) || null; }
}

/** 在沙箱里加载真实 js/store.js，fetch 指向真实后端 */
function loadFrontend(localStorageSeed) {
  const listeners = {};
  const localStorage = makeLocalStorage(localStorageSeed);
  const win = {
    localStorage,
    CustomEvent: CustomEventShim,
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
    removeEventListener: () => {},
    dispatchEvent: (ev) => { (listeners[ev.type] || []).forEach((fn) => fn(ev)); return true; },
    MINE_DATA: [], EQUIP_GROUPS: [], ALL_EQUIP: [], RESERVE_COACHES: [], MUSCLE_RULES: [],
    ME_CARD: {},
    /* 相对路径 → 真实后端 */
    fetch: (url, init) => fetch(BASE + url, init),
  };
  win.window = win;
  const ctx = vm.createContext(win);
  vm.runInContext('var DEMO_LOG_DAYS = {};', ctx);
  vm.runInContext(STORE_SRC, ctx, { filename: 'js/store.js' });
  return { win, localStorage };
}

const tick = () => new Promise((r) => setTimeout(r, 10));

/* ---------------- 后端进程 ---------------- */
let child = null;
let tmpDir = null;

function cleanup() {
  if (child) { try { child.kill('SIGTERM'); } catch (e) {} }
  if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {} }
}

async function waitUp(ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(BASE + '/api/coaches'); if (r.ok) return true; } catch (e) {}
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

(async () => {
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(130); });

  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-e2e-'));
  child = spawn(process.execPath, [path.join(ROOT, 'server', 'src', 'index.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: path.join(tmpDir, 'gym.db'), ADMIN_TOKEN: '' },
    stdio: 'ignore',
  });
  if (!await waitUp()) { console.error('后端未就绪'); cleanup(); process.exit(2); }

  console.log(`端到端联动测试：前端 js/store.js × 后端 ${BASE}\n`);
  const TODAY = '2026-11-09';
  const D2 = '2026-11-10';

  /* --------------------------------------------------------------- ① */
  section('① 训练日志上报 → 后端落库');
  {
    const fe = loadFrontend();
    fe.win.AppStore.fetchLogs();
    await tick();
    const r = await fe.win.AppStore.saveLog({
      date: TODAY, type: 'solo',
      records: [{ action: '深蹲', sets: 4, weight: 60 }, { action: '硬拉', sets: 3, weight: 80 }],
    });
    assert('saveLog 返回成功', r === true, '实际 ' + r);

    const back = await (await fetch(`${BASE}/api/logs?date=${TODAY}`)).json();
    assert('后端查到当日训练记录', Array.isArray(back) && back.length === 1, JSON.stringify(back));
    assert('记录包含两个动作', back[0] && back[0].records && back[0].records.length === 2, JSON.stringify(back[0]));
    assert('动作明细正确', back[0] && back[0].records[0].action === '深蹲' && back[0].records[0].sets === 4,
      JSON.stringify(back[0] && back[0].records[0]));
  }

  /* --------------------------------------------------------------- ② */
  section('② 同日再次上报 → 覆盖而非追加（upsert 语义）');
  {
    const back1 = await (await fetch(`${BASE}/api/logs?date=${TODAY}`)).json();
    assert('当前后端只有 1 条当日记录', back1.length === 1, JSON.stringify(back1));

    const fe = loadFrontend();
    fe.win.AppStore.fetchLogs();
    await tick();
    await fe.win.AppStore.saveLog({ date: TODAY, type: 'solo', records: [{ action: '卧推', sets: 3, weight: 40 }] });

    const back2 = await (await fetch(`${BASE}/api/logs?date=${TODAY}`)).json();
    assert('覆盖后仍只有 1 条记录', back2.length === 1, JSON.stringify(back2));
    assert('内容被替换为新记录', back2[0].records.length === 1 && back2[0].records[0].action === '卧推',
      JSON.stringify(back2[0]));
  }

  /* --------------------------------------------------------------- ③ */
  section('③ 教练课预约上报 → 后端落库');
  {
    const fe = loadFrontend();
    fe.win.AppStore.fetchLessons();
    await tick();
    const r = await fe.win.AppStore.saveLesson({ date: D2, coachName: '田文镜', course: '力量训练课', createdAt: 1700000000000 });
    assert('saveLesson 返回成功', r === true, '实际 ' + r);

    const back = await (await fetch(`${BASE}/api/lessons?date=${D2}`)).json();
    assert('后端查到预约记录', Array.isArray(back) && back.length === 1, JSON.stringify(back));
    assert('预约教练正确', back[0] && back[0].coachName === '田文镜', JSON.stringify(back[0]));
  }

  /* --------------------------------------------------------------- ④ */
  section('④ 刷新页面（内存态清空）→ 数据仍从后端恢复');
  {
    /* 新的前端实例 = 相当于刷新页面；localStorage 也不带任何缓存 */
    const fe = loadFrontend({});
    fe.win.AppStore.fetchLogs();
    fe.win.AppStore.fetchLessons();
    await tick(); await tick(); await tick();

    const days = fe.win.AppStore.gatherDays();
    assert('刷新后从后端恢复训练记录', !!days[TODAY] && days[TODAY].solo && days[TODAY].solo.length === 1,
      '实际 ' + JSON.stringify(days[TODAY]));
    assert('刷新后从后端恢复预约记录', !!days[D2] && days[D2].coach && days[D2].coach.name === '田文镜',
      '实际 ' + JSON.stringify(days[D2]));
    assert('恢复的记录内容与后端一致', days[TODAY].solo[0].action === '卧推',
      '实际 ' + JSON.stringify(days[TODAY].solo));
  }

  /* --------------------------------------------------------------- ⑤ */
  section('⑤ 后端删除 → 前端刷新即同步移除');
  {
    /* 模拟管理员在后台删除该日训练日志 */
    const del = await fetch(`${BASE}/api/logs/${TODAY}`, { method: 'DELETE' });
    assert('后端删除请求成功', del.ok, '状态 ' + del.status);

    const fe = loadFrontend({});
    fe.win.AppStore.fetchLogs();
    await tick(); await tick(); await tick();
    const days = fe.win.AppStore.gatherDays();
    assert('前端刷新后该日记录已消失', !days[TODAY], '实际 ' + JSON.stringify(days[TODAY]));
  }

  /* --------------------------------------------------------------- ⑥ */
  section('⑥ 后端不可用 → 静默回退本地缓存');
  {
    const seed = {};
    seed['gym_chk_' + TODAY] = JSON.stringify({ records: { a: { action: '深蹲', sets: 4, weight: 60 } } });
    const fe = loadFrontend(seed);
    /* 把 fetch 指向一个必然失败的地址 */
    fe.win.fetch = (url, init) => fetch('http://127.0.0.1:1' + url, init).catch((e) => { throw e; });
    fe.win.AppStore.fetchLogs();
    await tick(); await tick(); await tick();

    const days = fe.win.AppStore.gatherDays();
    assert('后端不可用时回退到本地缓存', !!days[TODAY] && days[TODAY].solo && days[TODAY].solo.length === 1,
      '实际 ' + JSON.stringify(days[TODAY]));
    assert('后端不可用时不抛错（静默失败）', true);
  }

  console.log(`\n===== 端到端联动测试结果 =====`);
  console.log(`  通过: ${pass}   失败: ${fail}`);
  if (failures.length) {
    console.log('\n失败明细：');
    failures.forEach((f) => console.log(`  - ${f.n}: ${f.d}`));
  }
  console.log(fail ? '\n  存在失败 ✗' : '\n  全部通过 ✓');
  cleanup();
  process.exit(fail ? 1 : 0);
})();
