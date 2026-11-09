#!/usr/bin/env node
'use strict';
/* =============================================================================
 * 前端数据层测试（API 优先 + localStorage 缓存兜底）
 *
 * 覆盖 js/store.js 的 M5 数据层核心语义：
 *   ① API 为主数据：本地缓存不得覆盖 API 已有的数据
 *   ② 管理员删除后同步移除：本地已同步的缓存不复活被 API 删除的记录
 *   ③ 离线回退：API 不可用时静默使用本地缓存
 *   ④ 离线补传：上报失败的本地记录在下次启动自动补传
 *   ⑤ 字段兼容：solo/records、createdAt/submittedAt 两种写法都能归一化
 *   ⑥ 合并优先级：API > localStorage(未同步) > 内置演示数据
 *
 * 实现方式：用 Node 内置 vm 模块加载真实的 js/store.js，
 *           配合轻量 DOM / localStorage / fetch 打桩（**不依赖 jsdom**）。
 *
 * 用法：node tests/store-test.js
 * 退出码：0 = 全通过；1 = 有失败
 * ============================================================================= */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const STORE_SRC = fs.readFileSync(path.join(ROOT, 'js', 'store.js'), 'utf8');
const DATA_SRC = fs.readFileSync(path.join(ROOT, 'js', 'data.js'), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function ok(name) { pass++; console.log(`  ✓ ${name}`); }
function bad(name, detail) {
  fail++; failures.push({ name, detail });
  console.log(`  ✗ ${name}\n      ${detail}`);
}
function assert(name, cond, detail) { cond ? ok(name) : bad(name, detail || '断言失败'); }
function assertEq(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  assert(name, a === e, `期望 ${e}，实际 ${a}`);
}
function section(t) { console.log(`\n${t}`); }

/* ---------------- 轻量 DOM / localStorage 打桩 ---------------- */

function makeLocalStorage(initial) {
  const map = new Map(Object.entries(initial || {}));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => { map.clear(); },
    key: (i) => Array.from(map.keys())[i] ?? null,
    get length() { return map.size; },
    _dump: () => Object.fromEntries(map),
  };
}

class CustomEventShim {
  constructor(type, init) { this.type = type; this.detail = (init && init.detail) || null; }
}

/**
 * 加载 js/store.js 到受控沙箱
 * @param {object} opts
 *   opts.fetchImpl  - fetch 打桩（可按路径返回不同结果）
 *   opts.localStorageSeed - localStorage 初始内容
 *   opts.demoDays   - 内置演示数据（模拟 data.js 的 DEMO_LOG_DAYS）
 */
function loadStore(opts) {
  const listeners = {};
  const localStorage = makeLocalStorage(opts.localStorageSeed);
  const requests = [];

  const win = {
    localStorage,
    CustomEvent: CustomEventShim,
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
    removeEventListener: () => {},
    dispatchEvent: (ev) => { (listeners[ev.type] || []).forEach((fn) => fn(ev)); return true; },
    MINE_DATA: [], EQUIP_GROUPS: [], ALL_EQUIP: [], RESERVE_COACHES: [], MUSCLE_RULES: [],
    ME_CARD: {},
    fetch: (url, init) => {
      requests.push({ url, init });
      return opts.fetchImpl(url, init);
    },
  };
  win.window = win;

  const ctx = vm.createContext(win);
  /* 先加载 data.js 的演示数据常量（store.js 通过标识符 DEMO_LOG_DAYS 直接引用） */
  if (opts.demoDays) {
    vm.runInContext(`var DEMO_LOG_DAYS = ${JSON.stringify(opts.demoDays)};`, ctx);
  }
  vm.runInContext(STORE_SRC, ctx, { filename: 'js/store.js' });

  return { win, ctx, localStorage, requests, listeners };
}

/* fetch 打桩：按路径返回预设数据；offline=true 时全部抛错 */
function makeFetch(routes, offline) {
  return (url, init) => {
    const p = url.split('?')[0];
    const method = (init && init.method) || 'GET';
    if (offline) return Promise.reject(new Error('offline'));
    if (routes[p]) {
      const r = routes[p];
      if (typeof r === 'function') return r(method, init);
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(r) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/* ============================================================================= */

(async () => {
  console.log('前端数据层测试（js/store.js · API 优先 + 本地缓存兜底）');

  /* ---------------------------------------------------------------- A */
  section('A. 归一化：兼容契约与存量两种字段名');
  {
    const s = loadStore({
      fetchImpl: makeFetch({
        '/api/logs': [
          { date: '2026-11-01', type: 'solo', records: [{ action: '深蹲', sets: 4, weight: 60 }] },
          { date: '2026-11-02', type: 'solo', solo: [{ action: '卧推', sets: 3, weight: 40 }] },   // 契约写法 solo
          { date: '2026-11-03', type: 'coach', records: [{ coach: '田文镜', course: '力量训练课' }] },
        ],
        '/api/lessons': [
          { date: '2026-11-04', coachName: '曹操', course: '体能提升课', createdAt: 1700000000000 },
          { date: '2026-11-05', coachName: '田文镜', course: '力量训练课', submittedAt: 1700000000001 }, // 契约写法 submittedAt
        ],
      }),
      demoDays: {},
    });
    s.win.AppStore.fetchLogs();
    s.win.AppStore.fetchLessons();
    await tick(); await tick(); await tick();

    const logs = s.win.LOG_DB, lessons = s.win.LESSON_DB;
    assert('records 字段被归一化', !!logs['2026-11-01'] && logs['2026-11-01'].solo.length === 1, JSON.stringify(logs['2026-11-01']));
    assert('solo 字段（契约写法）被归一化', !!logs['2026-11-02'] && logs['2026-11-02'].solo[0].action === '卧推', JSON.stringify(logs['2026-11-02']));
    assert('type=coach 被归一化为 coach 对象', !!logs['2026-11-03'] && logs['2026-11-03'].coach && logs['2026-11-03'].coach.name === '田文镜', JSON.stringify(logs['2026-11-03']));
    assert('createdAt 字段被保留', lessons['2026-11-04'].createdAt === 1700000000000, JSON.stringify(lessons['2026-11-04']));
    assert('submittedAt 字段兼容为 createdAt', lessons['2026-11-05'].createdAt === 1700000000001, JSON.stringify(lessons['2026-11-05']));
  }

  /* ---------------------------------------------------------------- B */
  section('B. API 为主数据：本地缓存不得覆盖 API');
  {
    const s = loadStore({
      fetchImpl: makeFetch({
        '/api/logs': [{ date: '2026-11-01', type: 'solo', records: [{ action: '深蹲', sets: 4, weight: 60 }] }],
        '/api/lessons': [],
      }),
      localStorageSeed: {
        /* 同一天、同一个动作，但组数重量不同 → API 的值必须胜出 */
        'gym_chk_2026-11-01': JSON.stringify({ records: { a: { action: '深蹲', sets: 99, weight: 999 } }, _synced: true }),
      },
      demoDays: {},
    });
    s.win.AppStore.fetchLogs();
    await tick(); await tick(); await tick();

    const day = s.win.AppStore.getDay('2026-11-01');
    assert('同日冲突时 API 数据胜出', day && day.solo && day.solo[0].sets === 4 && day.solo[0].weight === 60,
      '实际 ' + JSON.stringify(day));
  }

  /* ---------------------------------------------------------------- C */
  section('C. 管理员删除后同步移除（本地已同步缓存不复活记录）');
  {
    const s = loadStore({
      fetchImpl: makeFetch({
        '/api/logs': [],       // 管理员把 2026-11-01 的记录删了
        '/api/lessons': [],
      }),
      localStorageSeed: {
        'gym_chk_2026-11-01': JSON.stringify({ records: { a: { action: '深蹲', sets: 4, weight: 60 } }, _synced: true }),
      },
      demoDays: {},
    });
    s.win.AppStore.fetchLogs();
    await tick(); await tick(); await tick();

    const days = s.win.AppStore.gatherDays();
    assert('已同步的本地缓存不会复活被删除的记录', !days['2026-11-01'],
      '实际 ' + JSON.stringify(days['2026-11-01']));
  }

  /* ---------------------------------------------------------------- D */
  section('D. 离线回退：API 不可用时静默使用本地缓存');
  {
    const s = loadStore({
      fetchImpl: makeFetch({}, true),   // 全部请求失败
      localStorageSeed: {
        'gym_chk_2026-11-07': JSON.stringify({ records: { a: { action: '卧推', sets: 3, weight: 40 } } }),
      },
      demoDays: {},
    });
    s.win.AppStore.fetchLogs();
    await tick(); await tick(); await tick();

    const days = s.win.AppStore.gatherDays();
    assert('API 不可用时回退到本地缓存', !!days['2026-11-07'] && days['2026-11-07'].solo.length === 1,
      '实际 ' + JSON.stringify(days['2026-11-07']));
    assert('API 不可用时 LOG_DB 保持 null（未到达状态）', s.win.LOG_DB === null, '实际 ' + JSON.stringify(s.win.LOG_DB));
  }

  /* ---------------------------------------------------------------- E */
  section('E. 内置演示数据：仅在 API 未到达时作为底座');
  {
    const s = loadStore({
      fetchImpl: makeFetch({}, true),
      localStorageSeed: {},
      demoDays: { '2026-10-01': { solo: [{ action: '引体向上', sets: 3, weight: 0 }] } },
    });
    s.win.AppStore.fetchLogs();
    await tick(); await tick(); await tick();

    const days = s.win.AppStore.gatherDays();
    assert('API 未到达时使用内置演示数据', !!days['2026-10-01'] && days['2026-10-01'].solo.length === 1,
      '实际 ' + JSON.stringify(days['2026-10-01']));

    /* API 到达后，演示数据应让位给 API */
    const s2 = loadStore({
      fetchImpl: makeFetch({
        '/api/logs': [{ date: '2026-10-01', type: 'solo', records: [{ action: '深蹲', sets: 5, weight: 80 }] }],
        '/api/lessons': [],
      }),
      localStorageSeed: {},
      demoDays: { '2026-10-01': { solo: [{ action: '引体向上', sets: 3, weight: 0 }] } },
    });
    s2.win.AppStore.fetchLogs();
    await tick(); await tick(); await tick();
    const d2 = s2.win.AppStore.gatherDays();
    assert('API 到达后演示数据让位', d2['2026-10-01'].solo[0].action === '深蹲',
      '实际 ' + JSON.stringify(d2['2026-10-01']));
  }

  /* ---------------------------------------------------------------- F */
  section('F. 离线补传：启动时自动补传未同步的本地记录');
  {
    const posted = [];
    const s = loadStore({
      fetchImpl: makeFetch({
        '/api/logs': [],
        '/api/lessons': [],
        /* POST /api/logs 走这里的分支 */
      }, false),
      localStorageSeed: {
        'gym_chk_2026-11-08': JSON.stringify({ records: { a: { action: '深蹲', sets: 4, weight: 60 } } }),  // 未标记 _synced
        'gym_resv_2026-11-08': JSON.stringify({ coachName: '田文镜', course: '力量训练课' }),               // 未标记 _synced
      },
      demoDays: {},
    });
    /* 覆盖 fetch：记录 POST */
    const origFetch = s.win.fetch;
    s.win.fetch = (url, init) => {
      const method = (init && init.method) || 'GET';
      if (method === 'POST') {
        posted.push({ url, body: init && init.body });
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
      }
      return origFetch(url, init);
    };
    /* 用带 POST 处理的新沙箱重跑：直接在 loadStore 的 fetchImpl 里处理更清晰，故此处重新构造 */
    const s2 = loadStore({
      fetchImpl: (url, init) => {
        const method = (init && init.method) || 'GET';
        if (method === 'POST') {
          posted.push({ url, body: init && init.body });
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
        }
        if (url.startsWith('/api/logs')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
        if (url.startsWith('/api/lessons')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
      },
      localStorageSeed: {
        'gym_chk_2026-11-08': JSON.stringify({ records: { a: { action: '深蹲', sets: 4, weight: 60 } } }),
        'gym_resv_2026-11-08': JSON.stringify({ coachName: '田文镜', course: '力量训练课' }),
      },
      demoDays: {},
    });
    s2.win.AppStore.fetchLogs();
    s2.win.AppStore.fetchLessons();
    await tick(); await tick(); await tick(); await tick(); await tick();

    const logPosts = posted.filter((p) => p.url === '/api/logs');
    const lessonPosts = posted.filter((p) => p.url === '/api/lessons');
    assert('未同步的训练日志被补传', logPosts.length >= 1, 'POST /api/logs 次数=' + logPosts.length);
    assert('补传的日志内容正确', logPosts.length >= 1 && JSON.parse(logPosts[0].body).date === '2026-11-08',
      logPosts.length ? logPosts[0].body : '(无)');
    assert('未同步的预约被补传', lessonPosts.length >= 1, 'POST /api/lessons 次数=' + lessonPosts.length);
    assert('补传的预约内容正确', lessonPosts.length >= 1 && JSON.parse(lessonPosts[0].body).coachName === '田文镜',
      lessonPosts.length ? lessonPosts[0].body : '(无)');
    const cache = JSON.parse(s2.localStorage.getItem('gym_chk_2026-11-08'));
    assert('补传成功后本地缓存标记为已同步', cache && cache._synced === true, JSON.stringify(cache));
  }

  /* ---------------------------------------------------------------- G */
  section('G. 已同步的记录不会被重复补传');
  {
    const posted = [];
    const s = loadStore({
      fetchImpl: (url, init) => {
        const method = (init && init.method) || 'GET';
        if (method === 'POST') {
          posted.push({ url, body: init && init.body });
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
      },
      localStorageSeed: {
        'gym_chk_2026-11-09': JSON.stringify({ records: { a: { action: '深蹲', sets: 4, weight: 60 } }, _synced: true }),
      },
      demoDays: {},
    });
    s.win.AppStore.fetchLogs();
    await tick(); await tick(); await tick(); await tick();
    assert('已同步记录不重复上报', posted.length === 0, 'POST 次数=' + posted.length);
  }

  /* ---------------------------------------------------------------- H */
  section('H. 写入即上报，并更新内存视图');
  {
    const posted = [];
    const s = loadStore({
      fetchImpl: (url, init) => {
        const method = (init && init.method) || 'GET';
        if (method === 'POST') {
          posted.push({ url, body: init && init.body });
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
        }
        if (url.startsWith('/api/logs')) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
      },
      localStorageSeed: {},
      demoDays: {},
    });
    s.win.AppStore.fetchLogs();
    await tick(); await tick(); await tick();

    const r = await s.win.AppStore.saveLog({ date: '2026-11-10', type: 'solo', records: [{ action: '硬拉', sets: 5, weight: 100 }] });
    assert('saveLog 返回成功', r === true, '实际 ' + r);
    assert('saveLog 已 POST 到 /api/logs', posted.some((p) => p.url === '/api/logs'), JSON.stringify(posted));
    assert('saveLog 后内存视图包含该日', !!s.win.LOG_DB['2026-11-10'], JSON.stringify(s.win.LOG_DB));
  }

  /* ---------------------------------------------------------------- I */
  section('I. 删除当日日志（方案重新生成时同步清除）');
  {
    const calls = [];
    const s = loadStore({
      fetchImpl: (url, init) => {
        calls.push({ url, method: (init && init.method) || 'GET' });
        if ((init && init.method) === 'DELETE') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
      },
      localStorageSeed: {},
      demoDays: {},
    });
    s.win.AppStore.fetchLogs();
    await tick(); await tick(); await tick();

    const r = await s.win.AppStore.deleteLog('2026-11-11');
    assert('deleteLog 返回成功', r === true, '实际 ' + r);
    assert('deleteLog 发出 DELETE /api/logs/<date>', calls.some((c) => c.method === 'DELETE' && c.url === '/api/logs/2026-11-11'),
      JSON.stringify(calls));
  }

  /* ---------------------------------------------------------------- J */
  section('J. 评分（rating）只存本地，且不会让已删除的记录复活');
  {
    const s = loadStore({
      fetchImpl: makeFetch({ '/api/logs': [], '/api/lessons': [] }),
      localStorageSeed: {
        /* 有评分但该日教练记录已被 API 删除 → 不应复活 */
        'gym_resv_2026-11-12': JSON.stringify({ coachName: '曹操', course: '体能提升课', rating: 5, ratedAt: 1700000000000, _synced: true }),
      },
      demoDays: {},
    });
    s.win.AppStore.fetchLessons();
    await tick(); await tick(); await tick();

    const days = s.win.AppStore.gatherDays();
    assert('被 API 删除的预约不因本地评分而复活', !days['2026-11-12'], '实际 ' + JSON.stringify(days['2026-11-12']));

    /* API 仍在时，评分应被补回 */
    const s2 = loadStore({
      fetchImpl: makeFetch({
        '/api/logs': [],
        '/api/lessons': [{ date: '2026-11-13', coachName: '曹操', course: '体能提升课', createdAt: 1700000000000 }],
      }),
      localStorageSeed: {
        'gym_resv_2026-11-13': JSON.stringify({ coachName: '曹操', course: '体能提升课', rating: 5, ratedAt: 1700000000001, _synced: true }),
      },
      demoDays: {},
    });
    s2.win.AppStore.fetchLessons();
    await tick(); await tick(); await tick();
    const d2 = s2.win.AppStore.gatherDays();
    assert('API 记录存在时评分从本地补回', d2['2026-11-13'].coach && d2['2026-11-13'].coach.rating === 5,
      '实际 ' + JSON.stringify(d2['2026-11-13']));
  }

  /* ---------------------------------------------------------------- K */
  section('K. 写入先于 GET 快照时的竞态兜底（pendingLogs）');
  {
    let resolveGet;
    const s = loadStore({
      fetchImpl: (url, init) => {
        const method = (init && init.method) || 'GET';
        if (method === 'POST') return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
        if (url.startsWith('/api/logs')) {
          return new Promise((res) => { resolveGet = () => res({ ok: true, status: 200, json: () => Promise.resolve([]) }); });
        }
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
      },
      localStorageSeed: {},
      demoDays: {},
    });
    s.win.AppStore.fetchLogs();          // GET 挂起
    await tick();
    await s.win.AppStore.saveLog({ date: '2026-11-14', type: 'solo', records: [{ action: '深蹲', sets: 4, weight: 60 }] });
    resolveGet && resolveGet();         // GET 返回（不含刚写入的记录）
    await tick(); await tick(); await tick();

    const days = s.win.AppStore.gatherDays();
    assert('GET 快照不含刚写入记录时，仍能合并到视图', !!days['2026-11-14'],
      '实际 ' + JSON.stringify(days['2026-11-14']));
  }

  console.log(`\n===== 前端数据层测试结果 =====`);
  console.log(`  通过: ${pass}   失败: ${fail}`);
  if (failures.length) {
    console.log('\n失败明细：');
    failures.forEach((f) => console.log(`  - ${f.name}: ${f.detail}`));
  }
  console.log(fail ? '\n  存在失败 ✗' : '\n  全部通过 ✓');
  process.exit(fail ? 1 : 0);
})();
