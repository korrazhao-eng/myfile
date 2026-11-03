/* 管理后台逻辑：教练 / 器械与教程 / 用户档案 / 训练日志 / 课程记录
   数据层：/api/*（serve.py 轻量模拟后端，JSON 文件存储） */
'use strict';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

async function api(path, opts) {
  const r = await fetch('/api/' + path, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
  return data;
}
async function getList(coll) { return api(coll); }
async function saveItem(coll, body, id) {
  return api(coll + (id ? '/' + id : ''), {
    method: id ? 'PUT' : 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body)
  });
}
async function deleteItem(coll, id) { return api(coll + '/' + id, {method: 'DELETE'}); }

function toast(msg, ok = true) {
  const t = $('#admin-toast');
  t.textContent = msg;
  t.style.background = ok ? 'rgba(31,35,41,.92)' : 'rgba(196,60,48,.95)';
  t.classList.remove('hidden');
  clearTimeout(t._tm);
  t._tm = setTimeout(() => t.classList.add('hidden'), 2200);
}

/* ================= Tab 切换 ================= */
$('#tabs').addEventListener('click', e => {
  const b = e.target.closest('.tab'); if (!b) return;
  document.querySelectorAll('#tabs .tab').forEach(t => t.classList.toggle('active', t === b));
  document.querySelectorAll('.pane').forEach(p => p.classList.add('hidden'));
  $('#pane-' + b.dataset.pane).classList.remove('hidden');
  if (b.dataset.pane === 'profile') { loadUsers(); loadLogs(); }
  if (b.dataset.pane === 'lessons') loadLessons();
});

/* ================= 教练管理 ================= */
let coachEditing = null;

async function loadCoaches() {
  const list = await getList('coaches');
  $('#coach-tbody').innerHTML = list.map(c => `
    <tr>
      <td><b>${esc(c.name)}</b></td>
      <td>${esc(c.course || '')}</td>
      <td>${(c.tags || []).map(t => `<span class="tag-chip">${esc(t)}</span>`).join('')}</td>
      <td>
        <button class="btn mini" data-edit="${c.id}" type="button">编辑</button>
        <button class="btn mini danger" data-del="${c.id}" type="button">删除</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="4" class="empty">暂无教练，请在下方新增</td></tr>';
}

$('#coach-tbody').addEventListener('click', async e => {
  const del = e.target.closest('[data-del]');
  const edit = e.target.closest('[data-edit]');
  try {
    if (del) {
      if (!confirm('确定删除该教练？用户端预约页将不再展示。')) return;
      await deleteItem('coaches', del.dataset.del);
      toast('教练已删除'); loadCoaches();
    } else if (edit) {
      const list = await getList('coaches');
      const c = list.find(x => x.id === edit.dataset.edit);
      if (!c) return;
      coachEditing = c.id;
      $('#coach-form-title').textContent = '编辑教练：' + c.name;
      $('#coach-name').value = c.name; $('#coach-course').value = c.course || '';
      $('#coach-tags').value = (c.tags || []).join(',');
      $('#coach-cancel').classList.remove('hidden');
      window.scrollTo({top: document.body.scrollHeight, behavior: 'smooth'});
    }
  } catch (err) { toast('操作失败：' + err.message, false); }
});

$('#coach-save').addEventListener('click', async () => {
  const name = $('#coach-name').value.trim();
  if (!name) { toast('请填写教练姓名', false); return; }
  const body = {
    name,
    course: $('#coach-course').value.trim(),
    tags: $('#coach-tags').value.split(/[,，]/).map(s => s.trim()).filter(Boolean)
  };
  try {
    await saveItem('coaches', body, coachEditing);
    toast(coachEditing ? '教练已更新' : '教练已新增');
    resetCoachForm(); loadCoaches();
  } catch (err) { toast('保存失败：' + err.message, false); }
});
$('#coach-cancel').addEventListener('click', resetCoachForm);

function resetCoachForm() {
  coachEditing = null;
  $('#coach-form-title').textContent = '新增教练';
  $('#coach-name').value = ''; $('#coach-course').value = ''; $('#coach-tags').value = '';
  $('#coach-cancel').classList.add('hidden');
}

/* ================= 器械与教程 ================= */
let equipEditing = null;

async function loadEquips() {
  const list = await getList('equipments');
  const byType = {};
  list.forEach(eq => { (byType[eq.type] = byType[eq.type] || []).push(eq); });
  $('#equip-list').innerHTML = Object.keys(byType).map(type => `
    <div class="eq-group">
      <h3>${esc(type)}（${byType[type].length} 台）</h3>
      <table class="tbl"><tbody>
        ${byType[type].map(eq => `
          <tr>
            <td style="width:150px"><b>${esc(eq.name)}</b></td>
            <td><span class="cell-sub">教程视频</span><a class="link-cell" href="${esc(eq.videoUrl)}" target="_blank">${esc(eq.videoUrl)}</a>
                <span class="cell-sub">小红书外链</span><a class="link-cell" href="${esc(eq.videoJump)}" target="_blank">${esc(eq.videoJump)}</a></td>
            <td><span class="cell-sub">安全提示</span>${esc(eq.safety || '')}</td>
            <td class="w-op">
              <button class="btn mini" data-edit="${eq.id}" type="button">编辑</button>
              <button class="btn mini danger" data-del="${eq.id}" type="button">删除</button>
            </td>
          </tr>`).join('')}
      </tbody></table>
    </div>`).join('');
}

$('#equip-list').addEventListener('click', async e => {
  const del = e.target.closest('[data-del]');
  const edit = e.target.closest('[data-edit]');
  try {
    if (del) {
      if (!confirm('确定删除该器械？识别列表与详情页将不再展示。')) return;
      await deleteItem('equipments', del.dataset.del);
      toast('器械已删除'); loadEquips();
    } else if (edit) {
      const list = await getList('equipments');
      const eq = list.find(x => x.id === edit.dataset.edit);
      if (!eq) return;
      equipEditing = eq.id;
      $('#equip-form-title').textContent = '编辑器械：' + eq.name;
      $('#equip-type').value = eq.type; $('#equip-name').value = eq.name;
      $('#equip-video').value = eq.videoUrl || ''; $('#equip-jump').value = eq.videoJump || '';
      $('#equip-muscles').value = (eq.muscles || []).join(',');
      $('#equip-sub').value = (eq.subMuscles || []).join(',');
      $('#equip-safety').value = eq.safety || '';
      $('#equip-cancel').classList.remove('hidden');
      window.scrollTo({top: document.body.scrollHeight, behavior: 'smooth'});
    }
  } catch (err) { toast('操作失败：' + err.message, false); }
});

$('#equip-save').addEventListener('click', async () => {
  const name = $('#equip-name').value.trim();
  if (!name) { toast('请填写器械名称', false); return; }
  const body = {
    type: $('#equip-type').value, name,
    videoUrl: $('#equip-video').value.trim(),
    videoJump: $('#equip-jump').value.trim(),
    muscles: $('#equip-muscles').value.split(/[,，]/).map(s => s.trim()).filter(Boolean),
    subMuscles: $('#equip-sub').value.split(/[,，]/).map(s => s.trim()).filter(Boolean),
    safety: $('#equip-safety').value.trim()
  };
  try {
    await saveItem('equipments', body, equipEditing);
    toast(equipEditing ? '器械已更新' : '器械已新增');
    resetEquipForm(); loadEquips();
  } catch (err) { toast('保存失败：' + err.message, false); }
});
$('#equip-cancel').addEventListener('click', resetEquipForm);

function resetEquipForm() {
  equipEditing = null;
  $('#equip-form-title').textContent = '新增器械';
  $('#equip-name').value = ''; $('#equip-video').value = ''; $('#equip-jump').value = '';
  $('#equip-muscles').value = ''; $('#equip-sub').value = '';
  $('#equip-safety').value = '';
  $('#equip-cancel').classList.add('hidden');
}

/* ================= 用户数据（用户列表） ================= */
let userEditing = null;
let userDetailOpen = null;

/* 手机号脱敏：11 位显示前 3 后 4，其余原样 */
const maskPhone = p => {
  const s = String(p || '');
  return s.length === 11 ? s.slice(0, 3) + '****' + s.slice(7) : s;
};

/* 记录时间戳（心率/体测保存时自动生成，不可手动改） */
const nowStamp = () => {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
/* 数值展示：保留一位小数（体重 kg / 体脂率 %），空值返回空串 */
const fmt1 = v => (v === '' || v == null) ? '' : Number(v).toFixed(1);

async function loadUsers() {
  const [list, coaches] = await Promise.all([getList('users'), getList('coaches')]);
  const coachSel = $('#user-coach');
  if (coachSel.options.length <= 1) { // 教练下拉只初始化一次
    coaches.forEach(c => {
      const o = document.createElement('option');
      o.value = c.name; o.textContent = c.name;
      coachSel.appendChild(o);
    });
  }
  $('#user-tbody').innerHTML = list.map(u => {
    const heartText = (u.heart ?? '') !== '' ? `心率：${u.heart} 次/分${u.heartAt ? `（${u.heartAt}）` : ''}` : '';
    const hasBody = (u.weight ?? '') !== '' || (u.fatRate ?? '') !== '';
    const bodyText = hasBody ? `体测：体重 ${fmt1(u.weight) || '—'}kg／体脂 ${fmt1(u.fatRate) || '—'}%${u.bodyAt ? `（${u.bodyAt}）` : ''}` : '';
    const profileText = [heartText, bodyText].filter(Boolean).join('；');
    const open = userDetailOpen === u.id;
    return `
    <tr>
      <td><b>${esc(u.nickname)}</b></td>
      <td>${esc(maskPhone(u.phone))}</td>
      <td class="cell-ellipsis" title="${esc(profileText)}">${esc(profileText) || '—'}</td>
      <td>${esc(u.visitAt || '—')}</td>
      <td>${esc(u.coach || '—')}</td>
      <td class="cell-ellipsis" title="${esc(u.contract || '')}">${esc(u.contract || '—')}</td>
      <td class="cell-ellipsis" title="${esc(u.leave || '')}">${esc(u.leave || '—')}</td>
      <td class="w-op">
        <button class="btn mini" data-view="${u.id}" type="button">${open ? '收起' : '查看'}</button>
        <button class="btn mini" data-edit="${u.id}" type="button">编辑</button>
      </td>
    </tr>
    ${open ? `<tr class="user-detail-row"><td colspan="8">
      <div class="ud-grid">
        <span><i>手机号</i>${esc(u.phone || '—')}</span>
        <span><i>教练</i>${esc(u.coach || '无')}</span>
        <span><i>最近来访</i>${esc(u.visitAt || '—')}</span>
        <span><i>心率记录</i>${esc((u.heart ?? '') !== '' ? `${u.heart} 次/分（记录于 ${u.heartAt || '—'}）` : '—')}</span>
        <span><i>体测记录</i>${esc(hasBody ? `体重 ${fmt1(u.weight) || '—'}kg／体脂 ${fmt1(u.fatRate) || '—'}%（记录于 ${u.bodyAt || '—'}）` : '—')}</span>
        <span><i>合同记录</i>${esc(u.contract || '—')}</span>
        <span><i>请假记录</i>${esc(u.leave || '—')}</span>
      </div>
    </td></tr>` : ''}`;
  }).join('') || '<tr><td colspan="8" class="empty">暂无用户</td></tr>';
}

$('#user-tbody').addEventListener('click', async e => {
  const view = e.target.closest('[data-view]');
  const edit = e.target.closest('[data-edit]');
  try {
    if (view) {
      userDetailOpen = userDetailOpen === view.dataset.view ? null : view.dataset.view;
      loadUsers();
    } else if (edit) {
      const list = await getList('users');
      const u = list.find(x => x.id === edit.dataset.edit);
      if (!u) return;
      userEditing = u.id;
      $('#user-form-title').textContent = '编辑用户：' + u.nickname;
      $('#user-nickname').value = u.nickname || '';
      $('#user-phone').value = u.phone || '';
      $('#user-visit').value = u.visitAt || '';
      $('#user-coach').value = u.coach || '';
      $('#user-heart').value = u.heart ?? '';
      $('#user-weight').value = u.weight ?? '';
      $('#user-fat').value = u.fatRate ?? '';
      $('#user-cancel').classList.remove('hidden');
      window.scrollTo({top: document.body.scrollHeight, behavior: 'smooth'});
    }
  } catch (err) { toast('操作失败：' + err.message, false); }
});

$('#user-save').addEventListener('click', async () => {
  if (!userEditing) { toast('请先在列表点击「编辑」', false); return; } // 表单仅编辑模式，防止误存出重复记录
  const nickname = $('#user-nickname').value.trim();
  if (!nickname) { toast('请填写用户昵称', false); return; }
  /* 心率/体重/体脂率：数值字段；记录时间跟随输入——值变化时记保存时刻，未变沿用原时间 */
  const heartRaw = $('#user-heart').value.trim();
  const weightRaw = $('#user-weight').value.trim();
  const fatRaw = $('#user-fat').value.trim();
  const heart = heartRaw === '' ? '' : parseInt(heartRaw, 10);
  const weight = weightRaw === '' ? '' : Number(Number(weightRaw).toFixed(1));
  const fatRate = fatRaw === '' ? '' : Number(Number(fatRaw).toFixed(1));
  if ((heartRaw !== '' && !Number.isFinite(heart)) || (weightRaw !== '' && !Number.isFinite(weight)) || (fatRaw !== '' && !Number.isFinite(fatRate))) {
    toast('心率 / 体重 / 体脂率请填写有效数字', false); return;
  }
  let old = null;
  if (userEditing) {
    const list = await getList('users');
    old = list.find(x => x.id === userEditing) || null;
  }
  const heartChanged = String((old && old.heart) ?? '') !== String(heart);
  const bodyChanged = String((old && old.weight) ?? '') !== String(weight) || String((old && old.fatRate) ?? '') !== String(fatRate);
  const body = {
    nickname,
    phone: $('#user-phone').value.trim(),
    visitAt: $('#user-visit').value.trim(),
    coach: $('#user-coach').value,
    heart,
    heartAt: heart === '' ? '' : (heartChanged || !(old && old.heartAt) ? nowStamp() : old.heartAt),
    weight,
    fatRate,
    bodyAt: (weight === '' && fatRate === '') ? '' : (bodyChanged || !(old && old.bodyAt) ? nowStamp() : old.bodyAt)
  };
  try {
    await saveItem('users', body, userEditing);
    toast('用户已更新');
    userEditing = null;
    $('#user-form-title').textContent = '编辑用户';
    $('#user-cancel').classList.add('hidden');
    loadUsers();
  } catch (err) { toast('保存失败：' + err.message, false); }
});
$('#user-cancel').addEventListener('click', () => {
  userEditing = null;
  $('#user-form-title').textContent = '编辑用户';
  $('#user-cancel').classList.add('hidden');
});

async function loadLogs() {
  const logs = await getList('logs');
  const sorted = [...logs].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  $('#log-tbody').innerHTML = sorted.map(l => `
    <tr>
      <td>${esc(l.date || '')}</td>
      <td>${l.type === 'coach' ? '教练课' : '自由训练'}</td>
      <td>${(l.records || []).map(r => `${esc(r.action)} ${r.sets}组×${r.weight > 0 ? r.weight + 'kg' : '自重'}`).join(' ／ ') || '—'}</td>
    </tr>`).join('') || '<tr><td colspan="3" class="empty">暂无上报日志（用户端完成动作录入后同步）</td></tr>';
}

/* ================= 课程记录 ================= */
async function loadLessons() {
  const coachSel = $('#filter-coach');
  if (coachSel.options.length <= 1) { // 教练下拉只初始化一次
    const coaches = await getList('coaches');
    coaches.forEach(c => {
      const o = document.createElement('option');
      o.value = c.name; o.textContent = c.name;
      coachSel.appendChild(o);
    });
  }
  const coach = coachSel.value, date = $('#filter-date').value;
  const qs = [];
  if (coach) qs.push('coach=' + encodeURIComponent(coach));
  if (date) qs.push('date=' + date);
  const lessons = await getList('lessons' + (qs.length ? '?' + qs.join('&') : ''));
  const sorted = [...lessons].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  $('#lesson-tbody').innerHTML = sorted.map(l => `
    <tr>
      <td>${esc(l.date || '')}</td>
      <td><b>${esc(l.coachName || '')}</b></td>
      <td>${esc(l.course || '')}</td>
      <td class="cell-sub">${l.createdAt ? new Date(l.createdAt).toLocaleString('zh-CN') : ''}</td>
    </tr>`).join('') || '<tr><td colspan="4" class="empty">暂无预约记录</td></tr>';
}

$('#filter-coach').addEventListener('change', loadLessons);
$('#filter-date').addEventListener('change', loadLessons);
$('#filter-clear').addEventListener('click', () => {
  $('#filter-coach').value = ''; $('#filter-date').value = '';
  loadLessons();
});

/* ================= 方案配置（执行方案：热身 / 训练步骤 / 拉伸收尾） =================
   数据：GET /api/plans 全量拉取 → 本地编辑（输入即写入内存）→ PUT 全量保存；
   字段与用户端执行页渲染一一对应（stage/action/equipId/equipText/sets/repsTxt/w/focus/detail/rest） */
let PLANS = [];      // [{id, part, warmup:{targets,method,standard}, steps:[…], stretch:[…]}]
let EQUIP_OPTS = []; // 教学跳转器械下拉选项

async function loadPlans() {
  const [plans, equips] = await Promise.all([getList('plans'), getList('equipments')]);
  PLANS = Array.isArray(plans) ? plans : [];
  EQUIP_OPTS = (equips || []).map(e => ({ id: e.id, name: e.name }));
  renderPlans();
}

function stepCard(s, si) {
  return `
  <div class="step-card" data-si="${si}">
    <div class="sub-head"><span>训练步骤 ${si + 1}</span><button class="btn mini danger" data-del-step="${si}" type="button">删除</button></div>
    <div class="form-row">
      <label>阶段名<input data-f="stage" value="${esc(s.stage || '')}" placeholder="如：宽度构建（大重量复合）"/></label>
      <label>动作名称<input data-f="action" value="${esc(s.action || '')}"/></label>
      <label>组次展示文本<input data-f="repsTxt" value="${esc(s.repsTxt || '')}" placeholder="如：4组 × 12次／3组 × 12次/侧"/></label>
    </div>
    <div class="form-row">
      <label>教学跳转器械<select data-f="equipId">${EQUIP_OPTS.map(o => `<option value="${esc(o.id)}" ${o.id === s.equipId ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select></label>
      <label>器械展示文本<input data-f="equipText" value="${esc(s.equipText || '')}" placeholder="如：高位下拉机"/></label>
      <label>组数（录入预填）<input data-f="sets" type="number" min="1" step="1" value="${esc(s.sets ?? 3)}"/></label>
      <label>默认重量 kg<input data-f="w" type="number" min="0" step="0.5" value="${esc(s.w ?? 0)}"/></label>
    </div>
    <div class="form-row">
      <label class="grow">目标肌群<input data-f="focus" value="${esc(s.focus || '')}"/></label>
      <label>组间休息<input data-f="rest" value="${esc(s.rest || '')}" placeholder="如：90秒"/></label>
    </div>
    <div class="form-row">
      <label class="grow">膝盖友好点（可选，腿部方案用）<input data-f="knee" value="${esc(s.knee || '')}" placeholder="如：膝盖角度固定，剪切力小"/></label>
    </div>
    <div class="form-row">
      <label class="grow">关键细节<textarea data-f="detail" rows="2" placeholder="动作要领与常见错误">${esc(s.detail || '')}</textarea></label>
    </div>
  </div>`;
}

function stretchBlock(p) {
  const list = (p.stretch || []).map((s, i) => `
    <div class="step-card" data-sti="${i}">
      <div class="sub-head"><span>拉伸动作 ${i + 1}</span><button class="btn mini danger" data-del-stretch="${i}" type="button">删除</button></div>
      <div class="form-row">
        <label class="grow">动作<input data-f="action" value="${esc(s.action || '')}"/></label>
        <label class="grow">目标<input data-f="target" value="${esc(s.target || '')}"/></label>
        <label>时间<input data-f="time" value="${esc(s.time || '')}" placeholder="如：每侧30秒"/></label>
      </div>
    </div>`).join('');
  return `<div class="block-cap">拉伸收尾（${(p.stretch || []).length} 个动作）</div>${list}
    <button class="btn mini" data-add-stretch type="button">+ 新增拉伸动作</button>`;
}

function renderPlans() {
  if (!PLANS.length) {
    $('#plans-editor').innerHTML = '<table class="tbl"><tbody><tr><td class="empty">暂无方案配置（data/plans.json 为空或后端未启动）</td></tr></tbody></table>';
    return;
  }
  $('#plans-editor').innerHTML = PLANS.map((p, pi) => `
    <div class="form-card plan-part" data-pi="${pi}">
      <h3>${esc(p.part)} · 部位方案</h3>
      <div class="form-row">
        <label class="grow">热身 · 目标肌群<input data-f="targets" value="${esc(p.warmup?.targets || '')}"/></label>
        <label class="grow">热身 · 方式<input data-f="method" value="${esc(p.warmup?.method || '')}"/></label>
        <label class="grow">热身 · 标准<input data-f="standard" value="${esc(p.warmup?.standard || '')}"/></label>
      </div>
      <div class="block-cap">训练步骤（${(p.steps || []).length} 个）</div>
      ${(p.steps || []).map((s, si) => stepCard(s, si)).join('')}
      <button class="btn mini" data-add-step type="button">+ 新增训练步骤</button>
      ${stretchBlock(p)}
    </div>`).join('');
}

/* 输入即写入内存 PLANS（保存时一次 PUT 全量） */
$('#plans-editor').addEventListener('input', e => {
  const el = e.target;
  const part = el.closest('[data-pi]'); if (!part) return;
  const p = PLANS[Number(part.dataset.pi)]; if (!p) return;
  const f = el.dataset.f; if (!f) return;
  const step = el.closest('[data-si]');
  const st = el.closest('[data-sti]');
  if (step) {
    const s = p.steps[Number(step.dataset.si)];
    s[f] = (f === 'sets' || f === 'w') ? (Number(el.value) || 0) : el.value;
  } else if (st) {
    p.stretch[Number(st.dataset.sti)][f] = el.value;
  } else {
    p.warmup = p.warmup || {};
    p.warmup[f] = el.value;
  }
});

/* 新增 / 删除步骤与拉伸项（重渲染后焦点丢失，属预期） */
$('#plans-editor').addEventListener('click', e => {
  const part = e.target.closest('[data-pi]'); if (!part) return;
  const p = PLANS[Number(part.dataset.pi)]; if (!p) return;
  if (e.target.closest('[data-add-step]')) {
    p.steps = p.steps || [];
    p.steps.push({ stage: '', action: '', equipId: (EQUIP_OPTS[0] || {}).id || '', equipText: '', sets: 3, reps: 12, repsTxt: '', w: 20, focus: '', detail: '', rest: '60秒' });
    renderPlans(); return;
  }
  if (e.target.closest('[data-add-stretch]')) {
    p.stretch = p.stretch || [];
    p.stretch.push({ action: '', target: '', time: '' });
    renderPlans(); return;
  }
  const delStep = e.target.closest('[data-del-step]');
  if (delStep) { p.steps.splice(Number(delStep.dataset.delStep), 1); renderPlans(); return; }
  const delStretch = e.target.closest('[data-del-stretch]');
  if (delStretch) { p.stretch.splice(Number(delStretch.dataset.delStretch), 1); renderPlans(); }
});

$('#plans-save').addEventListener('click', async () => {
  try {
    await api('plans', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(PLANS) });
    toast('方案配置已保存，用户端重新生成方案即生效');
  } catch (err) { toast('保存失败：' + err.message, false); }
});

/* ================= 启动 ================= */
loadCoaches().catch(err => toast('加载失败：' + err.message, false));
loadEquips().catch(() => {});
loadLessons().catch(() => {});
loadPlans().catch(err => toast('方案配置加载失败：' + err.message, false));
