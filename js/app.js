/* 健身器械助手 V1.1 · 识别链路
   识别流程：点击取景框 / 相机按钮 → 上传图片 → 调用百度识图模型（未配置 Key 走 Mock）→ 返回候选侧滑大卡
   V1.1 增量：识别 Tab 双子 Tab（拍照/列表）、候选侧滑大卡、执行页动作完成+组次重量录入、日志当日详情
   全局框架：4 Tab 切换不重载、页面状态保留；二级页隐藏 Tab 栏 + 左上角返回 */
'use strict';

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ---------- 通用 ---------- */
let toastTimer = null;
function showToast(text, ms = 1500) {
  $('#toast-text').textContent = text;
  $('#toast').classList.remove('hidden');
  clearTimeout(toastTimer);
  if (ms > 0) toastTimer = setTimeout(hideToast, ms);
}
function hideToast() {
  clearTimeout(toastTimer);
  $('#toast').classList.add('hidden');
}

const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICON_WARN = `
<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 4 21 19H3z"/><path d="M12 10v3.6M12 16.4v.2"/>
</svg>`;

/* ---------- Tab 框架 ---------- */
function showTab(name) {
  document.body.dataset.tab = name;
  $$('.tab-page').forEach(p => p.classList.toggle('active', p.id === 'page-' + name));
  $$('#tabbar .tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  closeSubPages();
  if (name === 'home') { renderHomeCard(); renderHomeReserve(); renderSummary(); }
  if (name === 'log') renderLog();
}
function openSubPage(id) {
  document.body.classList.add('sub-open');
  $('#page-' + id).classList.add('active');
}
function closeSubPages() {
  document.body.classList.remove('sub-open');
  $$('.sub-page').forEach(p => p.classList.remove('active'));
}

/* ---------- 识别流程：上传图片 → 调用模型 → 返回候选 ---------- */
let camPhotoDataUrl = null;

// 入口：取景框 / 相机悬浮按钮点击 → 上传图片
function pickPhoto() {
  $('#photo-input').click();
}

$('#photo-input').addEventListener('change', e => {
  const file = e.target.files && e.target.files[0];
  e.target.value = ''; // 允许下次选择同一张图
  if (!file) return;
  const reader = new FileReader();
  reader.onerror = () => showToast('照片读取失败', 1500);
  reader.onload = ev => {
    camPhotoDataUrl = ev.target.result;
    openCameraWithPhoto();
  };
  reader.readAsDataURL(file);
});

function openCameraWithPhoto() {
  // 重置识别会话
  $('#cam-result').classList.add('hidden');
  candItems = []; candIdx = 0;
  $('#cand-swipe').innerHTML = '';
  $('#search-input').value = '';
  renderEquipGroups($('#fallback-list'), '', { mark: true });
  // 展示已上传照片
  $('#photo-holder').innerHTML = `<img src="${camPhotoDataUrl}" alt="照片预览"/>`;
  openSubPage('camera');
  recognize();
}

async function recognize() {
  showToast('识别中…', 0); // 持续到返回结果
  const useReal = !!(BAIDU_AI.API_KEY && BAIDU_AI.SECRET_KEY);
  let candidates = [], mode = 'mock', failed = false;
  try {
    if (useReal) {
      const raw = await baiduRecognize(camPhotoDataUrl);
      candidates = mapBaiduResults(raw);
      mode = 'baidu';
    } else {
      // Mock：模拟模型延迟后返回示例候选
      await new Promise(r => setTimeout(r, 1200));
      candidates = mockCandidates();
    }
  } catch (err) {
    failed = true;
    candidates = mockCandidates();
  }
  hideToast();
  if (failed) showToast('百度识别调用失败，已改用模拟结果', 1800);
  renderResults(candidates, mode);
  $('#cam-result').classList.remove('hidden');
}

// Mock 识别：随机取 3 个候选，相似度为示例值（降序，带轻微抖动）
function mockCandidates() {
  const base = [68, 54, 47];
  return shuffle(ALL_EQUIP).slice(0, 3)
    .map((it, i) => ({ ...it, sim: Math.min(80, base[i] + rand(-3, 3)) }));
}

/* 候选侧滑大卡（V1.1）：一次一张、左右滑动切换、圆点指示器；
   卡片=大图占位+器械名+发力点标签胶囊+相似度徽章+「就是它」；点卡片或点按钮均 → 器械详情页 */
let candItems = [], candIdx = 0;

function renderResults(candidates, mode) {
  $('#sec-cand-note').textContent = mode === 'baidu' ? '相似度为模型置信度' : '相似度为示例值';
  candItems = candidates; candIdx = 0;
  renderSwipe();
}

function renderSwipe() {
  const box = $('#cand-swipe');
  if (!candItems.length) {
    box.innerHTML = '<div class="empty-tip">未识别到器械库中的器械，请在下方列表手动选择</div>';
    return;
  }
  box.innerHTML = `
    <div class="swipe-wrap" id="swipe-wrap">
      <div class="swipe-track" id="swipe-track">
        ${candItems.map(it => `
          <div class="cand-card" data-eqid="${it.id}">
            <div class="cand-img">器械图片</div>
            <span class="cand-badge">${it.sim}% 相似</span>
            <div class="cand-name">${esc(it.name)}</div>
            <div class="cand-caps"><span class="capsule">${esc(it.muscle)}</span></div>
            <button class="btn-primary cand-btn" type="button">就是它</button>
          </div>`).join('')}
      </div>
      <div class="swipe-ind" id="swipe-ind"></div>
    </div>`;
  $('#swipe-track').style.transform = `translateX(-${candIdx * 100}%)`;
  renderSwipeInd();
  bindSwipe($('#swipe-wrap'));
}

function renderSwipeInd() {
  $('#swipe-ind').innerHTML = `
    <span class="swipe-dots">${candItems.map((_, i) => `<i class="dot ${i === candIdx ? 'on' : ''}"></i>`).join('')}</span>
    <span class="swipe-label">第 ${candIdx + 1}/${candItems.length} 张</span>`;
}

function bindSwipe(wrap) {
  let sx = null, dx = 0, dragging = false;
  wrap.addEventListener('pointerdown', e => { sx = e.clientX; dx = 0; dragging = true; });
  wrap.addEventListener('pointermove', e => { if (dragging) dx = e.clientX - sx; });
  wrap.addEventListener('pointerup', e => {
    if (!dragging) return;
    dragging = false;
    if (Math.abs(dx) > 40) { // 滑动切卡
      candIdx = Math.min(candItems.length - 1, Math.max(0, candIdx + (dx < 0 ? 1 : -1)));
      $('#swipe-track').style.transform = `translateX(-${candIdx * 100}%)`;
      renderSwipeInd();
    } else if (Math.abs(dx) < 8 && !e.target.closest('.cand-btn')) { // 点卡片 → 详情
      const card = e.target.closest('.cand-card');
      if (card) openDetail(card.dataset.eqid, 'camera');
    }
  });
  wrap.addEventListener('pointercancel', () => { dragging = false; });
  wrap.addEventListener('click', e => { // 「就是它」按钮 → 详情
    const b = e.target.closest('.cand-btn');
    if (b) openDetail(b.closest('.cand-card').dataset.eqid, 'camera');
  });
}

/* 器械分组列表（同源组件）：拍照识别页兜底 与 识别 Tab·列表子 Tab 共用
   按类型分组 + 搜索模糊匹配；无命中 → 「没有找到相关器械」；mark=选中标记（仅兜底场景） */
function renderEquipGroups(box, query, opts = {}) {
  const q = query.trim().toLowerCase();
  const groups = EQUIP_GROUPS
    .map(g => ({ ...g, items: g.items.filter(it => !q || it.name.toLowerCase().includes(q)) }))
    .filter(g => g.items.length);
  if (!groups.length) {
    box.innerHTML = '<div class="empty-tip">没有找到相关器械</div>';
    return;
  }
  box.innerHTML = groups.map(g => `
    <div class="fgroup">
      <h3>${esc(g.type)}</h3>
      ${g.items.map(it => `
        <div class="fitem" data-eqid="${it.id}">
          <span>${esc(it.name)}</span>
          ${opts.mark ? '<span class="mark">识别未命中但用户选定</span>' : ''}
        </div>`).join('')}
    </div>`).join('');
}

/* ---------- 器械详情 ---------- */
let detailFrom = 'camera';

function openDetail(id, from) {
  const eq = ALL_EQUIP.find(e => e.id === id);
  if (!eq) return;
  detailFrom = from;
  renderDetail(eq);
  openSubPage('detail');
}

// 字段空 → 整块隐藏：仅渲染有值的块
function renderDetail(eq) {
  const parts = [];

  if (eq.videoUrl) {
    parts.push(`
      <div class="video-test">
        <div class="video-cap">视频教程<span class="video-note">（测试示例，正式版替换真实教学视频）</span></div>
        <video class="video-player" src="${esc(eq.videoUrl)}" controls preload="metadata" playsinline></video>
        ${eq.videoJump ? `<a class="btn-video" href="${esc(eq.videoJump)}" target="_blank" rel="noopener">视频教程（跳转小红书）&gt;</a>` : ''}
      </div>`);
  }

  parts.push(`
    <div class="detail-cap">器械名称与目标肌群</div>
    <h2 class="detail-name">${esc(eq.name)}</h2>
    <div class="cap-row"><span class="cap-label">目标肌群</span><span class="capsule">${esc(eq.muscle)}</span></div>`);

  if (eq.safety) {
    parts.push(`
      <div class="warn-card">
        <div class="warn-cap">安全警示</div>
        <div class="warn-line">${ICON_WARN}${esc(eq.safety)}</div>
      </div>`);
  }

  if (eq.guide) {
    parts.push(`
      <div class="card">
        <div class="warn-cap">使用要点</div>
        <div style="font-size:14px;line-height:1.6">${esc(eq.guide)}</div>
      </div>`);
  }

  $('#detail-body').innerHTML = parts.join('');
}

/* ---------- 事件绑定 ---------- */
// Tab 切换
$$('#tabbar .tab').forEach(t => t.addEventListener('click', () => showTab(t.dataset.tab)));

// 识别 Tab：取景框 / 相机悬浮按钮 → 上传图片
$('#viewfinder').addEventListener('click', pickPhoto);
$('#fab-cam').addEventListener('click', pickPhoto);
$('#viewfinder').addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickPhoto(); }
});

// 拍照识别页返回 → 识别 Tab
$('#back-camera').addEventListener('click', () => showTab('identify'));

// 详情页返回 → 回来源页（来源二级页保持 active，直接隐藏详情即可）
$('#back-detail').addEventListener('click', () => {
  $('#page-detail').classList.remove('active');
});

// 识别 Tab 双子 Tab：拍照识别（默认）/ 列表
$('#id-subtabs').addEventListener('click', e => {
  const b = e.target.closest('.subtab');
  if (!b) return;
  $$('#id-subtabs .subtab').forEach(x => x.classList.toggle('active', x === b));
  const photo = b.dataset.pane === 'photo';
  $('#id-pane-photo').classList.toggle('hidden', !photo);
  $('#id-pane-list').classList.toggle('hidden', photo);
});
// 列表子 Tab：搜索 + 点器械行 → 器械详情页
$('#list-search').addEventListener('input', e => renderEquipGroups($('#list-body'), e.target.value));
$('#list-body').addEventListener('click', e => {
  const item = e.target.closest('.fitem');
  if (item) openDetail(item.dataset.eqid, 'identify');
});

// 兜底列表：折叠/展开、搜索、选定
$('#fall-toggle').addEventListener('click', () => {
  $('#fall-toggle').classList.toggle('collapsed');
  $('#fall-arrow').textContent = $('#fall-toggle').classList.contains('collapsed') ? '▸' : '▾';
  $('#fallback-body').classList.toggle('hidden');
});
$('#search-input').addEventListener('input', e => renderEquipGroups($('#fallback-list'), e.target.value, { mark: true }));

$('#fallback-list').addEventListener('click', e => {
  const item = e.target.closest('.fitem');
  if (!item) return;
  // 选中标记：识别未命中但用户选定
  $$('#fallback-list .fitem.selected').forEach(x => x.classList.remove('selected'));
  item.classList.add('selected');
  setTimeout(() => openDetail(item.dataset.eqid, 'camera'), 450);
});

/* ---------- M2 · 今日训练：主卡 / 今日方案 / 方案执行 / 完成弹层 ---------- */
const LS_PLAN = 'gym_plan_';   // 今日方案（按天）
const LS_CHK = 'gym_chk_';     // 当日执行记录（按天；V1.1：records=动作完成记录 动作/组数/重量）
const LS_MODAL = 'gym_done_modal_'; // 完成弹层已展示标记（每日一次）
const PARTS = Object.keys(PLAN_TEMPLATES);
let planPart = null; // 今日方案页当前选中部位

const ICON_PART = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M7 8v8M4.5 9.5v5M17 8v8M19.5 9.5v5M7 12h10"/></svg>`;
const WARMUP_TEXT = {
  '胸': '胸大肌（含上胸锁骨区）', '背': '背阔肌与斜方肌', '腿': '股四头肌与腘绳肌',
  '肩': '三角肌前中后束', '手臂': '肱二头肌与肱三头肌'
};

const todayStr = () => { const d = new Date(); const p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); };
const getPlan = () => { try { return JSON.parse(localStorage.getItem(LS_PLAN + todayStr())); } catch (e) { return null; } };
const savePlan = p => localStorage.setItem(LS_PLAN + todayStr(), JSON.stringify(p));
/* 当日执行记录：{ startedAt, finishedAt, warmupDone, records: { 动作序号: { action, sets, weight } } } */
const emptyExec = () => ({ startedAt: null, finishedAt: null, warmupDone: false, records: {} });
const getExec = () => {
  try {
    const v = JSON.parse(localStorage.getItem(LS_CHK + todayStr())) || {};
    return { ...emptyExec(), ...v, records: v.records || {} };
  } catch (e) { return emptyExec(); }
};
const saveExec = ex => localStorage.setItem(LS_CHK + todayStr(), JSON.stringify(ex));
const doneActions = ex => Object.keys(ex.records).length;
const totalSets = plan => plan.actions.reduce((s, a) => s + a.sets, 0);

/* 首页主卡：无方案=去选部位 / 进行中=开始·继续训练 / 已完成=查看方案（进度按动作口径） */
function renderHomeCard() {
  const box = $('#home-plan-card');
  const plan = getPlan();
  if (!plan) {
    box.innerHTML = `
      <div class="card home-plan">
        <div class="home-plan-title">今日：暂无方案</div>
        <button class="btn-primary" id="btn-goto-plan" type="button">去选部位</button>
      </div>`;
    $('#btn-goto-plan').addEventListener('click', openPlanPage);
    return;
  }
  const ex = getExec();
  const total = plan.actions.length, done = doneActions(ex);
  const finished = total > 0 && done >= total;
  const label = finished ? '查看方案' : (done > 0 ? '继续训练' : '开始训练');
  box.innerHTML = `
    <div class="card home-plan">
      <div class="home-plan-title">今日：${esc(plan.part)}</div>
      <div class="progress-row"><span class="progress-label">已完成动作</span><span class="progress-num">${done}/${total}</span></div>
      <div class="progress-track"><div class="progress-fill" style="width:${total ? Math.round(done / total * 100) : 0}%"></div></div>
      <button class="btn-primary" id="btn-home-go" type="button">${label}</button>
    </div>`;
  $('#btn-home-go').addEventListener('click', openExec);
}

/* 今日方案页：部位竖排列表单选 + 生成 */
function openPlanPage() {
  const p = getPlan();
  planPart = (p && p.part) || planPart || PARTS[0];
  renderPlanPage();
  openSubPage('plan');
}

function renderPlanPage() {
  $('#part-grid').innerHTML = PARTS.map(p => `
    <button class="part-item ${p === planPart ? 'selected' : ''}" type="button" data-part="${p}">
      <span class="pic">${ICON_PART}</span><span class="lb">${esc(p)}</span>
    </button>`).join('');
  $('#picked-part').textContent = planPart;
}

function generatePlan() {
  savePlan({ part: planPart, actions: PLAN_TEMPLATES[planPart].map(a => ({ ...a })), createdAt: Date.now() });
  localStorage.removeItem(LS_CHK + todayStr()); // 方案更新 → 当日执行记录重置
  invalidateSummaryCache(); // 记录变化 → 最近运动 AI 文案缓存失效
  renderPlanPage();
  renderHomeCard();
  renderSummary();
  showToast('今日方案已生成', 1500);
  openExec(); // 生成后直接进入方案执行页（PRD 主流程：选部位生成当日方案 → 进入方案执行页）
}

/* 方案执行页（V1.1）：热身激活轻量勾选 + 动作卡「完成」→ 组次重量录入弹层；全部动作完成自动弹完成弹层 */
function openExec() {
  const plan = getPlan();
  if (!plan) { openPlanPage(); return; }
  const ex = getExec();
  if (!ex.startedAt) { ex.startedAt = Date.now(); saveExec(ex); }
  renderExec();
  openSubPage('exec');
}

function renderExec() {
  const plan = getPlan();
  if (!plan) return;
  const ex = getExec();
  const n = plan.actions.length;
  $('#exec-sub').textContent = plan.part + ' · ' + n + ' 个动作 · 共 ' + totalSets(plan) + ' 组';
  const firstEq = plan.actions[0] && plan.actions[0].equipId;
  $('#exec-list').innerHTML = `
    <div class="action-row ${ex.warmupDone ? 'done' : ''}">
      <div class="action-head">
        <div><div class="action-name">第一步：热身激活</div>
        <div class="action-meta">预计 5 分钟 · 心率微微上升即可</div></div>
        <button class="teach-link" type="button" data-eqid="${firstEq}">教学 &gt;</button>
      </div>
      <ul class="warmup-pts">
        <li>目标肌群：${esc(WARMUP_TEXT[plan.part] || plan.part + '相关肌群')}，激活关节与肌肉</li>
        <li>方式：动态拉伸 + 轻重量器械试做</li>
      </ul>
      <div class="act-foot">
        ${ex.warmupDone
          ? '<span class="act-check">已完成 ✓</span>'
          : '<button class="btn-act lite" type="button" data-warmup="1">完成热身</button>'}
      </div>
    </div>` + plan.actions.map((a, i) => {
    const eq = ALL_EQUIP.find(x => x.id === a.equipId);
    const rec = ex.records[i];
    return `
      <div class="action-row ${rec ? 'done' : ''}">
        <div class="action-head">
          <div><div class="action-name">第${i + 2}步：${esc(a.action)}</div>
          <div class="action-meta">${esc(eq ? eq.name : '')} · ${a.sets} 组×${a.reps} 次</div></div>
          <button class="teach-link" type="button" data-eqid="${a.equipId}">教学 &gt;</button>
        </div>
        <div class="act-foot">
          ${rec
            ? `<span class="act-check">已完成 ✓</span><span class="rec-line">实际完成 ${rec.sets} 组 × ${rec.weight}kg</span>`
            : '<button class="btn-act" type="button" data-idx="' + i + '">完成</button>'}
        </div>
      </div>`;
  }).join('');
}

/* 组次重量录入弹层：默认按方案模板预填（组数=计划组数，重量=动作默认配置）；
   组数<1 或重量≤0 或留空 → 确认按钮置灰；确认后不可重复录入 */
let recIdx = null;

function openRecModal(i) {
  const plan = getPlan();
  if (!plan) return;
  const ex = getExec();
  if (ex.records[i]) return; // 已录入不可重复
  recIdx = i;
  const a = plan.actions[i];
  $('#rec-title').textContent = a.action;
  $('#rec-sets').value = a.sets;
  $('#rec-weight').value = a.w != null ? a.w : '';
  validateRec();
  $('#rec-modal').classList.remove('hidden');
}

function validateRec() {
  const s = Number($('#rec-sets').value), w = Number($('#rec-weight').value);
  const ok = $('#rec-sets').value !== '' && $('#rec-weight').value !== ''
    && Number.isInteger(s) && s >= 1 && w > 0;
  $('#rec-confirm').disabled = !ok;
  return ok;
}

const closeRecModal = () => { recIdx = null; $('#rec-modal').classList.add('hidden'); };

function confirmRec() {
  if (recIdx === null || !validateRec()) return;
  const plan = getPlan();
  const a = plan.actions[recIdx];
  const ex = getExec();
  ex.records[recIdx] = { action: a.action, sets: Number($('#rec-sets').value), weight: Number($('#rec-weight').value) };
  const allDone = plan.actions.length > 0 && doneActions(ex) >= plan.actions.length;
  if (allDone && !ex.finishedAt) ex.finishedAt = Date.now(); // 全部动作完成 = 今日训练完成
  saveExec(ex);
  AppStore.report('logs', { // M4：训练日志上报后端（按天 upsert，失败静默）
    date: todayStr(), type: 'solo',
    records: Object.values(ex.records).map(r => ({ action: r.action, sets: r.sets, weight: r.weight }))
  });
  invalidateSummaryCache(); // 录入新记录 → 最近运动 AI 文案缓存失效
  closeRecModal();
  renderExec();
  renderHomeCard();
  renderSummary();
  if (allDone && !localStorage.getItem(LS_MODAL + todayStr())) {
    localStorage.setItem(LS_MODAL + todayStr(), '1');
    showDoneModal(ex);
  }
}

/* 完成弹层：统计=各动作录入组数之和；每日一次 */
function showDoneModal(ex) {
  const min = Math.max(1, Math.round(((ex.finishedAt || Date.now()) - (ex.startedAt || Date.now())) / 60000));
  const sets = Object.values(ex.records).reduce((s, r) => s + r.sets, 0);
  $('#modal-stats').textContent = '本次共完成 ' + sets + ' 组 · 训练时长 ' + min + ' 分钟';
  $('#done-modal').classList.remove('hidden');
}
const hideDoneModal = () => $('#done-modal').classList.add('hidden');

/* ---------- M2 事件绑定 ---------- */
$('#back-plan').addEventListener('click', () => { renderHomeCard(); renderSummary(); closeSubPages(); });
$('#back-exec').addEventListener('click', () => { renderHomeCard(); renderSummary(); closeSubPages(); });

$('#part-grid').addEventListener('click', e => {
  const item = e.target.closest('.part-item');
  if (!item) return;
  planPart = item.dataset.part;
  renderPlanPage();
});
$('#btn-gen').addEventListener('click', generatePlan);
// 教练引导蓝字 → 预约留资页
$('#link-reserve').addEventListener('click', () => openReserve('plan'));

$('#exec-list').addEventListener('click', e => {
  const teach = e.target.closest('.teach-link');
  if (teach) { openDetail(teach.dataset.eqid, 'exec'); return; }
  const warm = e.target.closest('[data-warmup]');
  if (warm) { // 热身轻量勾选（可反复勾选/取消，不阻塞完成弹层触发）
    const ex = getExec();
    ex.warmupDone = !ex.warmupDone;
    saveExec(ex);
    renderExec();
    return;
  }
  const act = e.target.closest('.btn-act[data-idx]');
  if (act) openRecModal(Number(act.dataset.idx)); // 完成 → 组次重量录入弹层
});

// 组次重量录入弹层
$('#rec-sets').addEventListener('input', validateRec);
$('#rec-weight').addEventListener('input', validateRec);
$('#rec-confirm').addEventListener('click', confirmRec);
$('#rec-close').addEventListener('click', closeRecModal);
$('#rec-mask').addEventListener('click', closeRecModal);

// 重新选择 → 回今日方案页重选部位（重新生成会重置当日执行记录）
$('#btn-repick').addEventListener('click', () => { closeSubPages(); openPlanPage(); });

$('#modal-close').addEventListener('click', hideDoneModal);
$('#modal-mask').addEventListener('click', hideDoneModal);
$('#btn-coach').addEventListener('click', () => { hideDoneModal(); openReserve('modal'); });

/* ---------- M3 · 预约留资 / 首页预约卡 / 训练日志 / 我的 ---------- */
const LS_RESV = 'gym_resv_';
let resvCoach = null, resvFrom = 'modal';

const getResvToday = () => { try { return JSON.parse(localStorage.getItem(LS_RESV + todayStr())) || null; } catch { return null; } };

/* 预约留资页：教练单选（选教练即启用提交） */
function openReserve(from) {
  resvFrom = from || 'modal';
  resvCoach = null;
  renderReserve();
  openSubPage('reserve');
}
function renderReserve() {
  $('#coach-list').innerHTML = RESERVE_COACHES.map(c => `
    <button class="coach-card ${resvCoach === c.id ? 'selected' : ''}" type="button" data-id="${c.id}">
      <span class="cc-photo">头像区</span>
      <span class="cc-name">${esc(c.name)}</span>
      <span class="cc-tags">${c.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</span>
    </button>`).join('');
  $('#picked-coach').textContent = resvCoach ? RESERVE_COACHES.find(c => c.id === resvCoach).name : '未选择';
  $('#btn-submit-resv').disabled = !resvCoach;
}
$('#coach-list').addEventListener('click', e => {
  const b = e.target.closest('.coach-card'); if (!b) return;
  resvCoach = b.dataset.id; renderReserve();
});

/* 7 天内已有预约（无手机号可查，任何记录均算）则拦截重复提交 */
function hasRecentResv() {
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(LS_RESV)) continue;
    try {
      const r = JSON.parse(localStorage.getItem(key));
      if (r && Date.now() - r.createdAt < 7 * 86400000) return true;
    } catch {}
  }
  return false;
}
$('#btn-submit-resv').addEventListener('click', () => {
  if (!resvCoach) return;
  if (hasRecentResv()) { showToast('已提交过预约，教练会尽快联系你', 2000); return; }
  const coach = RESERVE_COACHES.find(c => c.id === resvCoach);
  localStorage.setItem(LS_RESV + todayStr(), JSON.stringify({
    coachName: coach.name, course: coach.course,
    createdAt: Date.now(), rating: null, ratedAt: null
  }));
  AppStore.report('lessons', { // M4：教练课预约上报后端（按天 upsert，失败静默）
    date: todayStr(), coachName: coach.name, course: coach.course, createdAt: Date.now()
  });
  invalidateSummaryCache(); // 教练课记录变化 → 最近运动 AI 文案缓存失效
  showToast('预约成功，教练会尽快联系你', 2000);
  closeSubPages(); renderHomeCard(); renderHomeReserve(); renderSummary();
});
$('#back-reserve').addEventListener('click', () => {
  closeSubPages();
  if (resvFrom === 'plan') openPlanPage(); else { renderHomeCard(); renderSummary(); }
});

/* 首页今日预约卡：有教练课（课程/教练+五星评分）/ 已评分（置灰）/ 无教练课（引导预约态） */
function renderHomeReserve() {
  const area = $('#home-reserve-area');
  const rec = getResvToday();
  if (!rec) {
    // 无预约：展示教练卡片（竖排卡：头像占位+姓名+标签），点卡进预约页
    area.innerHTML = `
      <div class="sec"><h2>今日预约</h2></div>
      <div class="resv-cards">${RESERVE_COACHES.map(c => `
        <button class="coach-card" type="button" data-id="${c.id}">
          <span class="cc-photo">头像区</span>
          <span class="cc-name">${esc(c.name)}</span>
          <span class="cc-tags">${c.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</span>
        </button>`).join('')}</div>`;
    return;
  }
  area.innerHTML = `
    <div class="sec"><h2>今日预约</h2></div>
    <div class="card">
      <div class="resv-row">
        <div class="resv-main"><div class="resv-course">${esc(rec.course)} · ${esc(rec.coachName)}教练</div></div>
        ${rec.rating
          ? `<span class="rate-done">已评分 ★${rec.rating}</span>`
          : `<div class="stars">${[1, 2, 3, 4, 5].map(n =>
              `<button class="star" type="button" data-n="${n}" aria-label="${n} 星">★</button>`).join('')}</div>`}
      </div>
    </div>`;
}
$('#home-reserve-area').addEventListener('click', e => {
  if (e.target.closest('.coach-card')) { openReserve('home'); return; }
  const s = e.target.closest('.star'); if (!s) return;
  const rec = getResvToday(); if (!rec || rec.rating) return;
  rec.rating = Number(s.dataset.n); rec.ratedAt = Date.now();
  localStorage.setItem(LS_RESV + todayStr(), JSON.stringify(rec));
  showToast('评分已提交', 1600);
  renderHomeReserve();
});

/* 训练日志页（V1.1）：月视图日历 + 点击日期展开当日详情
   格内图标：哑铃=自由训练 / 人像=教练课；图例在日历下方；再点同日或切月 → 收起 */
const ICON_SOLO = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/></svg>';
const ICON_COACH = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c1.5-3.5 4-5 7-5s5.5 1.5 7 5"/></svg>';
let calY = new Date().getFullYear(), calM = new Date().getMonth(); // 日历当前展示年月（0-based）
let selDate = null; // 当前展开详情的日期（YYYY-MM-DD）

function gatherLogDays() { // dateStr -> {solo:[{action,sets,weight}]|null, coach:{name,course}|null}；真实记录 + 演示数据合并
  const map = {};
  for (const [date, m] of Object.entries(DEMO_LOG_DAYS)) {
    map[date] = { solo: m.solo || null, coach: m.coach || null };
  }
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    if (key.startsWith(LS_CHK)) {
      const date = key.slice(LS_CHK.length);
      try {
        const ex = JSON.parse(localStorage.getItem(key));
        const recs = Object.values((ex && ex.records) || {});
        if (recs.length) {
          (map[date] = map[date] || {}).solo = recs.map(r => ({ action: r.action, sets: r.sets, weight: r.weight }));
        }
      } catch {}
    } else if (key.startsWith(LS_RESV)) {
      const date = key.slice(LS_RESV.length);
      try {
        const r = JSON.parse(localStorage.getItem(key));
        if (r) (map[date] = map[date] || {}).coach = { name: r.coachName, course: r.course };
      } catch {}
    }
  }
  return map;
}

/* 当日详情：自由训练明细列表 + 教练信息卡片（复用预约页 .coach-card 样式）；两类并存上下都展示 */
function renderDayDetail(m) {
  const parts = [];
  if (m.solo && m.solo.length) {
    parts.push(`
      <div class="day-card">
        <div class="day-cap">${ICON_SOLO}自由训练</div>
        ${m.solo.map(r => `<div class="day-row">${esc(r.action)} × ${r.sets} 组 × ${r.weight}kg</div>`).join('')}
      </div>`);
  }
  if (m.coach) {
    const c = RESERVE_COACHES.find(x => x.name === m.coach.name);
    const tags = c ? c.tags : [];
    parts.push(`
      <div class="day-card">
        <div class="day-cap">${ICON_COACH}教练课</div>
        <div class="coach-card">
          <span class="cc-photo">头像区</span>
          <span class="cc-name">${esc(m.coach.name)}教练</span>
          <span class="dd-course">${esc(m.coach.course)}</span>
          <span class="cc-tags">${tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</span>
        </div>
      </div>`);
  }
  if (!parts.length) return '<div class="day-card rest">该日休息</div>';
  return parts.join('');
}

function renderLog() {
  const map = gatherLogDays();
  const startDow = new Date(calY, calM, 1).getDay(); // 1 号是周几（0=日）
  const days = new Date(calY, calM + 1, 0).getDate();
  const todayS = todayStr();
  let cells = '';
  for (let i = 0; i < startDow; i++) cells += '<div class="cal-cell blank"></div>';
  for (let d = 1; d <= days; d++) {
    const ds = `${calY}-${String(calM + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const m = map[ds] || {};
    const marks = (m.solo ? ICON_SOLO : '') + (m.coach ? ICON_COACH : '');
    cells += `<div class="cal-cell ${ds === todayS ? 'today' : ''} ${ds === selDate ? 'sel' : ''}" data-date="${ds}"><span class="cal-day">${d}</span><span class="cal-marks">${marks}</span></div>`;
  }
  let detail = '';
  if (selDate) {
    const [, mm, dd] = selDate.split('-');
    detail = `
      <div class="day-detail">
        <div class="day-date">${Number(mm)} 月 ${Number(dd)} 日</div>
        ${renderDayDetail(map[selDate] || {})}
      </div>`;
  }
  $('#log-body').innerHTML = `
    <div class="cal-card">
      <div class="cal-head">
        <button class="cal-nav" id="cal-prev" type="button" aria-label="上一月">‹</button>
        <div class="cal-title">${calY} 年 ${calM + 1} 月</div>
        <button class="cal-nav" id="cal-next" type="button" aria-label="下一月">›</button>
      </div>
      <div class="cal-week">${['日', '一', '二', '三', '四', '五', '六'].map(w => `<span>${w}</span>`).join('')}</div>
      <div class="cal-grid">${cells}</div>
    </div>
    <div class="cal-legend"><span>${ICON_SOLO} 自由训练</span><span>${ICON_COACH} 教练课</span></div>
    ${detail}`;
}
$('#log-body').addEventListener('click', e => {
  if (e.target.closest('#cal-prev')) { calM--; if (calM < 0) { calM = 11; calY--; } selDate = null; renderLog(); return; }
  if (e.target.closest('#cal-next')) { calM++; if (calM > 11) { calM = 0; calY++; } selDate = null; renderLog(); return; }
  const cell = e.target.closest('.cal-cell:not(.blank)');
  if (!cell) return;
  const ds = cell.dataset.date;
  selDate = selDate === ds ? null : ds; // 再点同日 → 收起
  renderLog();
});

/* 我的页面：个人资料卡 + 四宫格记录入口（M4：main/sub 来自后端 profile，点击 toast 摘要） */
function renderMine() {
  $('#mine-body').innerHTML = `
  <div class="me-card">
    <span class="me-avatar">头像
      <i class="me-cam"><svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 8h3l2-2h6l2 2h3v11H4z"/><circle cx="12" cy="13" r="3"/></svg></i>
    </span>
    <span class="me-info">
      <span class="me-id">U0946 <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M13.5 6.5l3 3"/></svg></span>
      <span class="me-phone">183-4605-0946</span>
    </span>
  </div>
  <div class="me-grid">${MINE_DATA.map(m => `
    <button class="me-item" type="button" data-title="${m.title}"><span class="me-ico">${m.icon}</span><span>${m.title}</span></button>`).join('')}
  </div>`;
}
renderMine();
$('#mine-body').addEventListener('click', e => {
  const b = e.target.closest('.me-item'); if (!b) return;
  const m = MINE_DATA.find(x => x.title === b.dataset.title);
  showToast(m.main + (m.sub ? ' · ' + m.sub : ''), 2000);
});

/* M4：后端配置到达后刷新依赖配置的已渲染视图（store.js 派发 appdata 事件） */
window.addEventListener('appdata', () => {
  renderMine();
  renderHomeReserve(); renderHomeCard();
  renderEquipGroups($('#list-body'), $('#list-search').value || '');
});

/* ---------- 启动：默认落首页 Tab ---------- */
/* 窄窗口等比缩放：<500px 时手机壳保持 390 设计宽，按窗口宽 scale，铺满且布局不变形（真实手机上无此窗口问题） */
function fitPhone() {
  const phone = $('#phone');
  const vw = document.documentElement.clientWidth;
  if (vw >= 500) { phone.style.transform = ''; phone.style.width = ''; phone.style.height = ''; return; }
  const s = vw / 390;
  phone.style.width = '390px';
  phone.style.height = (window.innerHeight / s) + 'px'; // 高度除以缩放补偿，视觉上铺满整屏
  phone.style.transform = 'scale(' + s + ')';
  phone.style.transformOrigin = 'top center';
}
window.addEventListener('resize', fitPhone);
fitPhone();

AppStore.init(); // M4：拉取后端配置（教练/器械/档案），到达后经 appdata 事件刷新视图；失败回退内置默认值

renderEquipGroups($('#list-body'), ''); // 识别 Tab·列表子 Tab 初始数据
showTab('home');
