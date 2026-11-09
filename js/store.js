/* M4 · 前端配置接入层：启动拉取后端配置，原位替换 data.js 常量内容
   - data.js 的 EQUIP_GROUPS / ALL_EQUIP / RESERVE_COACHES / MINE_DATA 均为 const：
     本模块只替换「数组内容」（length=0 再 push），引用不变 → 下游代码零改动
   - 拉取失败（如 GitHub Pages 纯静态托管无 /api）→ 静默回退内置默认值，不弹提示
   - 完成替换后派发 'appdata' 事件，app.js 监听后刷新已渲染视图

   M5 · 训练日志 / 教练课预约：改为「API 为主数据，localStorage 仅作缓存与离线回退」
   - 读：GET /api/logs、GET /api/lessons 归一化进内存（window.LOG_DB / window.LESSON_DB），
         再与 localStorage 缓存合并（API 优先；API 未覆盖的日期用本地补齐）→ gatherDays()
   - 写：先落 localStorage 缓存（_synced=false），再 POST 上报；成功后置 _synced=true
   - 上报失败的本地记录在下次启动自动补传（syncPending），全流程失败静默、不弹 Toast */
(function () {
  'use strict';

  /* 「我的」页四宫格图标属于 UI 资产，留在前端按 title 注入（后端只存 title/main/sub） */
  var MINE_ICONS = {};
  (window.MINE_DATA || []).forEach(function (m) { MINE_ICONS[m.title] = m.icon; });

  function replaceInPlace(arr, items) {
    arr.length = 0;
    items.forEach(function (it) { arr.push(it); });
  }

  /* 后端 equipments 为扁平数组 → 按出现顺序重建前端分组结构 EQUIP_GROUPS */
  function toGroups(list) {
    var groups = [];
    var index = {};
    list.forEach(function (eq) {
      if (!index[eq.type]) {
        index[eq.type] = { type: eq.type, items: [] };
        groups.push(index[eq.type]);
      }
      index[eq.type].items.push({ id: eq.id, name: eq.name });
    });
    return groups;
  }

  /* 与 data.js ALL_EQUIP 的摊平逻辑一致：补默认字段 */
  function buildAllEquip(list) {
    var flat = [];
    list.forEach(function (eq) {
      flat.push({
        type: eq.type,
        muscle: '背部',
        videoUrl: eq.videoUrl || VIDEO_TEST_URL,
        videoJump: eq.videoJump || VIDEO_JUMP_URL,
        safety: eq.safety || SAFETY_WARNING,
        guide: eq.guide || '',
        muscles: Array.isArray(eq.muscles) ? eq.muscles : [],
        subMuscles: Array.isArray(eq.subMuscles) ? eq.subMuscles : [],
        id: eq.id,
        name: eq.name
      });
    });
    return flat;
  }

  function applyBootstrap(data) {
    if (!data || !Array.isArray(data.equipments) || !Array.isArray(data.coaches)) return false;
    replaceInPlace(window.EQUIP_GROUPS, toGroups(data.equipments));
    replaceInPlace(window.ALL_EQUIP, buildAllEquip(data.equipments));
    replaceInPlace(window.RESERVE_COACHES, data.coaches.map(function (c) {
      return { id: c.id, name: c.name, course: c.course || '', tags: c.tags || [] };
    }));
    if (Array.isArray(data.profile)) { // 我的页：后端只管文案，icon 前端注入
      replaceInPlace(window.MINE_DATA, data.profile.map(function (p) {
        return { title: p.title, main: p.main || '', sub: p.sub || '', icon: MINE_ICONS[p.title] || '' };
      }));
    }
    if (Array.isArray(data.mappings) && Array.isArray(window.MUSCLE_RULES)) { // 动作→肌群映射（summary.js 消费）
      replaceInPlace(window.MUSCLE_RULES, data.mappings.map(function (m) {
        return { keyword: m.keyword || '', muscle: m.muscle || '' };
      }).filter(function (m) { return m.keyword && m.muscle; }));
    }
    window.dispatchEvent(new CustomEvent('appdata'));
    return true;
  }

  /* 我的页会员卡：从 /api/users 取当前用户（u1）的编号/手机号/会员等级 */
  function fetchMe() {
    fetch('/api/users')
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (users) {
        if (!Array.isArray(users)) return;
        var me = users.find(function (u) { return u.id === 'u1'; }) || users[0];
        if (me) {
          window.ME_CARD = {
            no: me.memberNo || 'U0946',
            phone: me.phone || '183-4605-0946',
            level: me.memberLevel || '年度会员'
          };
          window.dispatchEvent(new CustomEvent('appdata'));
        }
      })
      .catch(function () { /* 无后端环境：保留内置默认值 */ });
  }

  function init() {
    if (!window.EQUIP_GROUPS) return; // data.js 未加载时不动
    fetch('/api/bootstrap')
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (data) { applyBootstrap(data); })
      .catch(function () { /* 无后端环境：保留内置默认值 */ });
    fetchMe();
  }

  /* ================= M5 · 训练日志 / 教练课预约：API 为主数据 =================
     归一化后的内存结构（供 app.js / summary.js 统一消费）：
       window.LOG_DB    : { date: { solo: [{action,sets,weight}] | null, coach: {name,course} | null } }
       window.LESSON_DB : { date: { coachName, course, createdAt } }
     null = 尚未到达；{} = 已到达但为空 */

  var LS_CHK = 'gym_chk_';    // 当日执行记录缓存前缀（与 app.js 保持一致，避免加载顺序依赖）
  var LS_RESV = 'gym_resv_';  // 教练课预约缓存前缀（与 app.js 保持一致）

  window.LOG_DB = null;
  window.LESSON_DB = null;

  /* 已上报成功、但 GET 快照里还没包含的记录（写入先于拉取的竞态兜底） */
  var pendingLogs = {};
  var pendingLessons = {};

  /* ---------- 网络 ---------- */

  function getJSON(path) {
    return fetch('/api/' + path, { headers: { 'Accept': 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }
  function postJSON(path, payload) {
    return fetch('/api/' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }

  /* ---------- 归一化 ---------- */

  /* 动作明细：兼容契约里的 solo 与存量实现的 records 两种字段名 */
  function normRecords(recs) {
    if (!Array.isArray(recs)) return [];
    return recs.filter(function (r) { return r && r.action; }).map(function (r) {
      return { action: String(r.action), sets: Number(r.sets) || 0, weight: Number(r.weight) || 0 };
    });
  }

  /* 单条训练日志 → { date, solo, coach } */
  function normLog(rec) {
    if (!rec || !rec.date) return null;
    var raw = Array.isArray(rec.records) ? rec.records : (Array.isArray(rec.solo) ? rec.solo : []);
    var solo = normRecords(raw);
    var coach = null;
    if (rec.coach && (rec.coach.name || rec.coach.coachName)) {
      coach = { name: rec.coach.name || rec.coach.coachName, course: rec.coach.course || '' };
    } else if (rec.type === 'coach') {
      var r0 = raw[0] || {};
      coach = { name: r0.coach || r0.name || r0.action || '', course: r0.course || '' };
    }
    return { date: rec.date, solo: solo.length ? solo : null, coach: coach };
  }

  /* 单条预约 → { date, coachName, course, createdAt } */
  function normLesson(rec) {
    if (!rec || !rec.date) return null;
    var name = rec.coachName || (rec.coach && rec.coach.name) || '';
    if (!name) return null;
    var course = rec.course || (rec.coach && rec.coach.course) || '';
    var createdAt = rec.createdAt;
    if (createdAt == null && rec.submittedAt) createdAt = rec.submittedAt;
    return { date: rec.date, coachName: name, course: course, createdAt: createdAt == null ? null : createdAt };
  }

  /* 统一的教练课对象（渲染层同时用 name 与 coachName 两个字段名） */
  function mkCoach(name, course, createdAt) {
    return {
      name: name || '', coachName: name || '', course: course || '',
      createdAt: createdAt == null ? null : createdAt,
      rating: null, ratedAt: null
    };
  }

  /* ---------- localStorage 缓存读取 ---------- */

  function localChkEntries() {
    var out = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (!key || key.indexOf(LS_CHK) !== 0) continue;
        var ex = null;
        try { ex = JSON.parse(localStorage.getItem(key)); } catch (e) { continue; }
        if (!ex) continue;
        out.push({ date: key.slice(LS_CHK.length), exec: ex });
      }
    } catch (e) { /* localStorage 不可用（隐私模式）→ 忽略 */ }
    return out;
  }

  function localResvEntries() {
    var out = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (!key || key.indexOf(LS_RESV) !== 0) continue;
        var rec = null;
        try { rec = JSON.parse(localStorage.getItem(key)); } catch (e) { continue; }
        if (!rec) continue;
        out.push({ date: key.slice(LS_RESV.length), rec: rec });
      }
    } catch (e) { /* localStorage 不可用 → 忽略 */ }
    return out;
  }

  /* 标记本地缓存已同步（上报成功后调用） */
  function markSynced(cacheKey) {
    try {
      var raw = localStorage.getItem(cacheKey);
      if (!raw) return;
      var obj = JSON.parse(raw);
      if (!obj || obj._synced === true) return;
      obj._synced = true;
      localStorage.setItem(cacheKey, JSON.stringify(obj));
    } catch (e) { /* ignore */ }
  }

  /* ---------- 拉取（API 为主数据） ---------- */

  var inflight = 0;
  function settle() {
    inflight--;
    if (inflight <= 0) { inflight = 0; syncPending(); }
  }

  function fetchLogs() {
    inflight++;
    return getJSON('logs')
      .then(function (list) {
        var db = {};
        (Array.isArray(list) ? list : []).forEach(function (rec) {
          var n = normLog(rec);
          if (n) db[n.date] = n;
        });
        window.LOG_DB = db;
        Object.keys(pendingLogs).forEach(function (d) { db[d] = pendingLogs[d]; });
        window.dispatchEvent(new CustomEvent('appdata'));
      })
      .catch(function () {
        /* 无后端环境（GitHub Pages）：保留内置演示数据（LOG_DB 仍为 null） */
      })
      .then(settle, settle);
  }

  function fetchLessons() {
    inflight++;
    return getJSON('lessons')
      .then(function (list) {
        var db = {};
        (Array.isArray(list) ? list : []).forEach(function (rec) {
          var n = normLesson(rec);
          if (n) db[n.date] = n;
        });
        window.LESSON_DB = db;
        Object.keys(pendingLessons).forEach(function (d) { db[d] = pendingLessons[d]; });
        window.dispatchEvent(new CustomEvent('appdata'));
      })
      .catch(function () {
        /* 无后端环境：保留内置演示数据 */
      })
      .then(settle, settle);
  }

  /* ---------- 合并视图（API 优先，localStorage 为缓存与离线回退） ---------- */

  function gatherDays() {
    var out = {};
    var logs = window.LOG_DB;      // null = 未到达
    var lessons = window.LESSON_DB;
    var logsReady = logs !== null;
    var lessonsReady = lessons !== null;

    function ensure(date) {
      if (!out[date]) out[date] = { solo: null, coach: null };
      return out[date];
    }

    /* ① 内置演示数据：仅在 API 未到达时作为回退底座（不写死业务数据——失败才回退）
          注：data.js 里 DEMO_LOG_DAYS 为顶层 const（不挂 window），按标识符直接取 */
    if (!logsReady) {
      var demo = (typeof DEMO_LOG_DAYS !== 'undefined' && DEMO_LOG_DAYS) ? DEMO_LOG_DAYS : {};
      Object.keys(demo).forEach(function (date) {
        var m = demo[date] || {};
        var d = ensure(date);
        if (m.solo && m.solo.length) d.solo = normRecords(m.solo);
        if (m.coach) d.coach = mkCoach(m.coach.name, m.coach.course, null);
      });
    }

    /* ② API 数据（logs + lessons）：覆盖演示数据 */
    if (logs) {
      Object.keys(logs).forEach(function (date) {
        var m = logs[date] || {};
        var d = ensure(date);
        if (m.solo && m.solo.length) d.solo = normRecords(m.solo);
        if (m.coach) d.coach = mkCoach(m.coach.name, m.coach.course, null);
      });
    }
    if (lessons) {
      Object.keys(lessons).forEach(function (date) {
        var m = lessons[date] || {};
        ensure(date).coach = mkCoach(m.coachName, m.course, m.createdAt);
      });
    }

    /* ③ localStorage 缓存：
         · API 已到达且本地记录已同步 → 以 API 为准（管理员删除的记录不会被本地缓存复活）
         · 本地未同步（上报失败）→ 以本地为准，并等待补传 */
    localChkEntries().forEach(function (it) {
      var recs = normRecords(Object.keys(it.exec.records || {}).map(function (k) { return it.exec.records[k]; }));
      if (!recs.length) return;
      if (logsReady && it.exec._synced === true) return;
      var d = ensure(it.date);
      if (d.solo && d.solo.length) return; // API 已覆盖该日 → API 优先
      d.solo = recs;
    });
    localResvEntries().forEach(function (it) {
      var r = it.rec || {};
      if (!r.coachName) return;
      if (lessonsReady && r._synced === true) return;
      var d = ensure(it.date);
      if (d.coach) return; // API 已覆盖该日 → API 优先
      d.coach = mkCoach(r.coachName, r.course, r.createdAt);
    });

    /* ④ 评分（rating）只存在于本地缓存 → 始终补回（该日教练记录已被 API 移除则不复活） */
    localResvEntries().forEach(function (it) {
      var r = it.rec || {};
      if (r.rating == null) return;
      var d = out[it.date];
      if (!d || !d.coach) return;
      d.coach.rating = r.rating;
      d.coach.ratedAt = r.ratedAt == null ? null : r.ratedAt;
    });

    return out;
  }

  /* 单日合并视图 */
  function getDay(date) {
    var days = gatherDays();
    return days[date] || null;
  }

  /* API 中某日的自由训练明细（无则 null；供执行页把录入记录回填到方案动作） */
  function getApiSolo(date) {
    var logs = window.LOG_DB;
    if (!logs || !logs[date] || !logs[date].solo) return null;
    return logs[date].solo.map(function (r) { return { action: r.action, sets: r.sets, weight: r.weight }; });
  }

  /* 近 N 天内有教练课预约的日期集合（API + 本地缓存；不含内置演示数据） */
  function lessonDays() {
    var set = {};
    var lessons = window.LESSON_DB;
    if (lessons) Object.keys(lessons).forEach(function (d) { set[d] = true; });
    localResvEntries().forEach(function (it) {
      if (it.rec && it.rec.coachName) set[it.date] = true;
    });
    return set;
  }

  /* ---------- 写入（先缓存后上报，上报成功标记已同步） ---------- */

  function saveLog(payload) {
    return postJSON('logs', payload)
      .then(function () {
        var n = normLog(payload);
        if (n) {
          pendingLogs[n.date] = n;
          if (window.LOG_DB) window.LOG_DB[n.date] = n;
        }
        markSynced(LS_CHK + payload.date);
        window.dispatchEvent(new CustomEvent('appdata'));
        return true;
      })
      .catch(function () { return false; }); // 上报失败：本地缓存已写入，下次启动补传
  }

  function saveLesson(payload) {
    return postJSON('lessons', payload)
      .then(function () {
        var n = normLesson(payload);
        if (n) {
          pendingLessons[n.date] = n;
          if (window.LESSON_DB) window.LESSON_DB[n.date] = n;
        }
        markSynced(LS_RESV + payload.date);
        window.dispatchEvent(new CustomEvent('appdata'));
        return true;
      })
      .catch(function () { return false; });
  }

  /* 删除某日训练日志（方案重新生成 → 当日执行记录重置时用；失败静默） */
  function deleteLog(date) {
    return fetch('/api/logs/' + encodeURIComponent(date), { method: 'DELETE' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return true; })
      .then(function () {
        delete pendingLogs[date];
        if (window.LOG_DB) delete window.LOG_DB[date];
        window.dispatchEvent(new CustomEvent('appdata'));
        return true;
      })
      .catch(function () { return false; });
  }

  /* ---------- 离线补传：把未同步成功的本地缓存重新上报 ---------- */

  function syncPending() {
    localChkEntries().forEach(function (it) {
      var recs = normRecords(Object.keys(it.exec.records || {}).map(function (k) { return it.exec.records[k]; }));
      if (!recs.length) return;
      if (it.exec._synced === true) return;
      if (window.LOG_DB && window.LOG_DB[it.date]) { markSynced(LS_CHK + it.date); return; } // API 已有该日 → 视为已同步
      saveLog({ date: it.date, type: 'solo', records: recs });
    });
    localResvEntries().forEach(function (it) {
      var r = it.rec || {};
      if (!r.coachName) return;
      if (r._synced === true) return;
      if (window.LESSON_DB && window.LESSON_DB[it.date]) { markSynced(LS_RESV + it.date); return; }
      saveLesson({ date: it.date, coachName: r.coachName, course: r.course || '', createdAt: r.createdAt });
    });
  }

  window.AppStore = {
    init: init,
    applyBootstrap: applyBootstrap,
    fetchLogs: fetchLogs,
    fetchLessons: fetchLessons,
    gatherDays: gatherDays,
    getDay: getDay,
    getApiSolo: getApiSolo,
    lessonDays: lessonDays,
    saveLog: saveLog,
    saveLesson: saveLesson,
    deleteLog: deleteLog,
    syncPending: syncPending
  };
})();
