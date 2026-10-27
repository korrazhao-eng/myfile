/* M4 · 前端配置接入层：启动拉取后端配置，原位替换 data.js 常量内容
   - data.js 的 EQUIP_GROUPS / ALL_EQUIP / RESERVE_COACHES / MINE_DATA 均为 const：
     本模块只替换「数组内容」（length=0 再 push），引用不变 → 下游代码零改动
   - 拉取失败（如 GitHub Pages 纯静态托管无 /api）→ 静默回退内置默认值，不弹提示
   - 完成替换后派发 'appdata' 事件，app.js 监听后刷新已渲染视图
   - report(path, data)：用户端动作异步上报（日志/预约），fire-and-forget 不阻塞 UI */
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
    window.dispatchEvent(new CustomEvent('appdata'));
    return true;
  }

  function init() {
    if (!window.EQUIP_GROUPS) return; // data.js 未加载时不动
    fetch('/api/bootstrap')
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (data) { applyBootstrap(data); })
      .catch(function () { /* 无后端环境：保留内置默认值 */ });
  }

  /* 上报：训练日志 / 教练课预约。失败静默（本地 localStorage 仍是数据主源） */
  function report(path, payload) {
    try {
      fetch('/api/' + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch(function () {});
    } catch (e) { /* ignore */ }
  }

  window.AppStore = { init: init, report: report, applyBootstrap: applyBootstrap };
})();
