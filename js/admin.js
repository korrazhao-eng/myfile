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
      <td>${(l.records || []).map(r => `${esc(r.action)} ${r.sets}组×${r.weight}kg`).join(' ／ ') || '—'}</td>
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

/* ================= 启动 ================= */
loadCoaches().catch(err => toast('加载失败：' + err.message, false));
loadEquips().catch(() => {});
loadLessons().catch(() => {});
