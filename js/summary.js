/* 健身器械助手 V1.2 · 首页「最近运动」摘要卡（REQ-2026-0061）
   聚合口径：
   - 7 天滑动窗口（今天~今天-6），按天去重计次：当天有自由训练或教练课任一记录 = 1 次
   - 状态判定只对比自由训练记录（gym_chk_），教练课不参与进步/停滞/退步对比
     进步=重量↑或组数↑（vs 该动作上一次）；退步=重量或组数下降；
     停滞=连续 ≥3 次同重量同组数；首次记录=无历史
   - 反馈区最多 2 条：优先级 退步＞停滞＞进步＞首次记录，同优先级取最近训练动作
   - 频率与恢复区最多 2 条：恢复类优先于练频率，恢复类之间无休＞同肌群连练
     （同肌群判断：AI 链路由模型基于 7 天每日训练数据判断；本地兜底按动作名关键词映射）
   文案链路：LLM 按示例模板生成（serve.py /proxy/llm 代理，Key 在 config.local.js LLM_KEYS）
     → 未配置/超时/失败静默降级本地模板引擎，不弹 Toast
   刷新：每次进入首页实时聚合（showTab/visibilitychange）；AI 文案当日缓存（gym_sum_ai_日期），
     录入新记录后由 app.js 调 invalidateSummaryCache() 失效 */
'use strict';

const LS_SUM_AI = 'gym_sum_ai_';       // AI 文案当日缓存 key 前缀（+YYYY-MM-DD）
const LS_CHK_REF = 'gym_chk_';         // 与 app.js LS_CHK 一致（避免加载顺序依赖）
const LS_RESV_REF = 'gym_resv_';       // 与 app.js LS_RESV 一致
const SUM_LLM_MODEL = 'glm-4-flash';
const SUM_AI_TIMEOUT = 15000;          // AI 超时毫秒数（实测 glm-4-flash 常态 5~8s），超时静默降级
const SUM_AI_RETRY_GAP = 60000;        // AI 失败后的静默重试间隔

const sumDStr = d => { const p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); };
const sumRelDay = n => { const d = new Date(); d.setDate(d.getDate() - n); return sumDStr(d); };

/* 动作名 → 肌群（仅本地模板引擎兜底用；测试期器械库 muscle 全是「背部」不可用） */
function muscleOf(action) {
  const rules = [
    [/后束|侧平举|前平举|推肩|肩/, '肩'],
    [/直臂|下拉|划船|背/, '背'],
    [/腿|深蹲|髋/, '腿'],
    [/三头|二头|弯举|下压|臂/, '手臂'],
    [/胸|夹胸/, '胸']
  ];
  for (const [re, m] of rules) if (re.test(action)) return m;
  return '全身';
}

/* 聚合全量训练数据：date -> {solo:[{action,sets,weight}], coach:{name,course}|null}
   演示数据（DEMO_LOG_DAYS，动态锚定今天-N 天）+ localStorage 真实记录（真实记录覆盖同日演示数据） */
function gatherAllDays() {
  const map = {};
  for (const [date, m] of Object.entries(DEMO_LOG_DAYS)) {
    map[date] = { solo: (m.solo || []).slice(), coach: m.coach || null };
  }
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    try {
      if (key.startsWith(LS_CHK_REF)) {
        const ex = JSON.parse(localStorage.getItem(key));
        const recs = Object.values((ex && ex.records) || {});
        if (recs.length) {
          const date = key.slice(LS_CHK_REF.length);
          (map[date] = map[date] || { solo: [], coach: null })
            .solo = recs.map(r => ({ action: r.action, sets: r.sets, weight: r.weight }));
        }
      } else if (key.startsWith(LS_RESV_REF)) {
        const r = JSON.parse(localStorage.getItem(key));
        if (r && r.coachName) {
          const date = key.slice(LS_RESV_REF.length);
          (map[date] = map[date] || { solo: [], coach: null }).coach = { name: r.coachName, course: r.course };
        }
      }
    } catch {}
  }
  return map;
}

/* 构建摘要数据：{count, feedback:[{state,action,date,cur,prev,delta,streak}], tips:[{kind,type,muscle,text}]} */
function buildSummary() {
  const days = gatherAllDays();
  const windowDates = [];
  for (let i = 0; i < 7; i++) windowDates.push(sumRelDay(i));
  const winSet = new Set(windowDates);

  // 按天去重计次（教练课参与次数统计）
  const hasRec = d => { const m = days[d]; return !!m && ((m.solo && m.solo.length) || m.coach); };
  const count = windowDates.filter(hasRec).length;

  // 动作历史（全量含窗口外，判断「首次=无历史」与停滞连击）：action -> [{date,sets,weight}] 升序
  const hist = {};
  Object.keys(days).sort().forEach(date => {
    ((days[date] || {}).solo || []).forEach(r => {
      if (!r.action) return;
      (hist[r.action] = hist[r.action] || []).push({ date, sets: r.sets, weight: r.weight });
    });
  });

  // 状态反馈候选：该动作最近一次训练落在窗口内才进入摘要
  const fbPool = [];
  for (const [action, occ] of Object.entries(hist)) {
    const cur = occ[occ.length - 1];
    if (!winSet.has(cur.date)) continue;
    const item = { action, date: cur.date, cur: { sets: cur.sets, weight: cur.weight }, prev: null, delta: { sets: 0, weight: 0 }, streak: 0, state: '' };
    if (occ.length < 2) {
      item.state = '首次记录';
    } else {
      const prev = occ[occ.length - 2];
      item.prev = { sets: prev.sets, weight: prev.weight };
      const ds = cur.sets - prev.sets;
      const dw = Math.round((cur.weight - prev.weight) * 10) / 10;
      item.delta = { sets: ds, weight: dw };
      if (ds > 0 || dw > 0) item.state = '进步';
      else if (ds < 0 || dw < 0) item.state = '退步';
      else {
        // 同重量同组数：从最新往前数连续相同次数，≥3 进入停滞（2 次相同未达停滞，不出条目）
        let streak = 1;
        for (let i = occ.length - 2; i >= 0; i--) {
          const a = occ[i], b = occ[i + 1];
          if (a.sets === b.sets && a.weight === b.weight) streak++; else break;
        }
        if (streak >= 3) { item.state = '停滞'; item.streak = streak; }
        else continue;
      }
    }
    fbPool.push(item);
  }
  // 优先级 退步＞停滞＞进步＞首次记录；同优先级取最近训练日期
  const PRI = { '退步': 0, '停滞': 1, '进步': 2, '首次记录': 3 };
  fbPool.sort((a, b) => PRI[a.state] - PRI[b.state] || (a.date < b.date ? 1 : -1));
  const feedback = fbPool.slice(0, 2);

  // 频率与恢复建议（恢复类优先于练频率；恢复类之间：无休 > 同肌群）
  const tips = [];
  if (count >= 7) tips.push({ kind: '恢复', type: 'no_rest', muscle: '', text: '近 7 天训练无休，建议安排一天主动恢复' });
  const mgDays = {};
  windowDates.forEach(d => (((days[d] || {}).solo) || []).forEach(r => {
    const mg = muscleOf(r.action);
    (mgDays[mg] = mgDays[mg] || new Set()).add(d);
  }));
  const consecMg = [];
  for (const mg of Object.keys(mgDays)) {
    for (let i = 0; i < 6; i++) {
      if (mgDays[mg].has(sumRelDay(i)) && mgDays[mg].has(sumRelDay(i + 1))) { consecMg.push(mg); break; }
    }
  }
  if (consecMg.length) tips.push({ kind: '恢复', type: 'same_muscle', muscle: consecMg.join('、'), text: `${consecMg.join('、')}连续两天高强度，建议间隔 48 小时再练同一部位` });
  if (count === 1) tips.push({ kind: '频率', type: 'low', muscle: '', text: '本周训练 1 次，频率偏低，建议每周保持 2~3 次' });
  else if (count >= 5) tips.push({ kind: '频率', type: 'high', muscle: '', text: `近 7 天训练 ${count} 次，节奏很满，注意留出恢复时间` });

  return { count, feedback, tips: tips.slice(0, 2) };
}

/* 数据指纹：进入指纹的只有事实（日期/次数/状态/动作/组次重量/建议类型），
   AI 文案缓存按指纹命中——录入新记录指纹变化即视为失效 */
function sumFingerprint(data) {
  return JSON.stringify([
    sumRelDay(0), data.count,
    data.feedback.map(f => [f.state, f.action, f.cur.sets, f.cur.weight, f.prev ? f.prev.sets : null, f.prev ? f.prev.weight : null, f.streak || 0]),
    data.tips.map(t => [t.type, t.muscle || '', data.count])
  ]);
}

/* ---------- 本地模板引擎（降级文案，按示例模板风格） ---------- */
function localFbText(f) {
  if (f.state === '首次记录') {
    return `这是你第一次记录${f.action}，先以轻重量 ${f.cur.sets} 组 × ${f.cur.weight}kg 熟悉调节和轨迹`;
  }
  if (f.state === '进步') {
    if (f.delta.weight > 0) return `${f.action}比上次多 ${f.delta.weight}kg，保持这个节奏，下次可尝试再加 1 组`;
    return `${f.action}比上次多 ${f.delta.sets} 组，保持这个节奏，状态在线`;
  }
  if (f.state === '退步') {
    if (f.delta.sets < 0) return `${f.action}比上次少 ${-f.delta.sets} 组，是疲劳还是状态不好？建议下次降负荷，重点保动作质量`;
    return `${f.action}比上次少 ${-f.delta.weight}kg，是疲劳还是状态不好？建议下次降负荷，重点保动作质量`;
  }
  if (f.state === '停滞') {
    const w = Math.round(f.cur.weight * 0.9 * 10) / 10;
    return `${f.action} ${f.streak} 次没变化，建议下次减 10% 重量（约 ${w}kg），或换角度刺激`;
  }
  return '';
}

/* ---------- AI 文案链路（/proxy/llm → 智谱 OpenAI 兼容接口） ---------- */
function sumAIAvailable() {
  return typeof window.LLM_KEYS !== 'undefined' && window.LLM_KEYS && !!window.LLM_KEYS.API_KEY;
}

async function fetchAISummaryCopy(data) {
  const payload = {
    近7天训练次数: data.count,
    反馈: data.feedback.map(f => ({ 状态: f.state, 动作: f.action, 本次: f.cur, 上一次: f.prev, 连续相同次数: f.streak || null })),
    建议: data.tips.map(t => ({ 类别: t.kind, 类型: t.type, 涉及肌群: t.muscle || null }))
  };
  const sys = '你是健身助手的文案模块。基于给定的结构化训练数据，为「最近运动」摘要卡生成文案：按示例模板风格，只改写文案，不改变事实与数值；每条一句话（32 字以内），口语化、鼓励但诚实。' +
    '示例风格——进步「腿举比上次多 5kg，保持这个节奏，下周尝试 4×10」；停滞「推胸 3 次没变化，建议下次减 10% 重量做 4×12，或换角度刺激」；退步「深蹲比上次少 2 组，是疲劳还是状态不好？建议下次降负荷，重点保动作质量」；首次记录「这是你第一次记录哈克深蹲，先以轻重量 2×12 熟悉调节和轨迹」；恢复「背部连续两天高强度，建议间隔 48 小时」；频率低「本周训练 1 次，频率偏低，建议每周保持 2~3 次」；频率高「近 7 天训练 5 次，节奏很满，注意留出恢复时间」。' +
    '注意：反馈文案不要以动作名开头（动作名在卡片上单独展示）。' +
    `本次输入 feedback ${data.feedback.length} 条、tips ${data.tips.length} 条，必须逐条全部输出、顺序与输入一致，不得合并或遗漏。` +
    '严格输出 JSON，不要任何多余文本：{"feedback":[{"state":"与输入一致","action":"与输入一致","text":"..."}],"tips":[{"kind":"恢复或频率","text":"..."}]}。';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SUM_AI_TIMEOUT);
  try {
    const res = await fetch('/proxy/llm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + window.LLM_KEYS.API_KEY },
      body: JSON.stringify({
        model: SUM_LLM_MODEL,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: JSON.stringify(payload) }
        ],
        temperature: 0.4,
        max_tokens: 800
      }),
      signal: ctrl.signal
    });
    if (!res.ok) throw new Error('llm http ' + res.status);
    const j = await res.json();
    const txt = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('llm no json');
    const out = JSON.parse(m[0]);
    if (!Array.isArray(out.feedback) || !Array.isArray(out.tips)) throw new Error('llm bad shape');
    // 事实字段以本地判定为准，AI 只提供文案；逐条对齐——AI 漏回/空文案的条目用本地模板兜底，不整包丢弃
    const feedback = data.feedback.map((f, i) => {
      const x = out.feedback[i];
      const text = x && String(x.text || '').trim();
      return { state: f.state, action: f.action, text: text || localFbText(f) };
    });
    const tips = data.tips.map((t, i) => {
      const x = out.tips[i];
      const text = x && String(x.text || '').trim();
      return { kind: t.kind, text: text || t.text };
    });
    return { feedback, tips };
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- AI 文案当日缓存 ---------- */
function readSummaryAICache(fp) {
  try {
    const c = JSON.parse(localStorage.getItem(LS_SUM_AI + sumRelDay(0)));
    if (c && c.fp === fp) return c.result;
  } catch {}
  return null;
}
function writeSummaryAICache(fp, result) {
  try { localStorage.setItem(LS_SUM_AI + sumRelDay(0), JSON.stringify({ fp, result })); } catch {}
}
/* 录入新记录 / 预约提交后失效（app.js 调用） */
function invalidateSummaryCache() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(LS_SUM_AI)) keys.push(k);
  }
  keys.forEach(k => localStorage.removeItem(k));
}

/* ---------- 渲染（纯展示不可点击；空态隐藏反馈/恢复区） ---------- */
const SUM_FB_PILL = { '进步': 's-prog', '停滞': 's-stall', '退步': 's-reg', '首次记录': 's-first' };

function sumCardHTML(data, ai) {
  const head = `
    <div class="sum-head">
      <span class="sum-title">最近运动</span>
      <span class="sum-badge">近 7 天训练 ${data.count} 次</span>
    </div>`;
  if (!data.count) {
    return `<div class="card sum-card">${head}<div class="sum-empty">近 7 天还没有训练记录，练完一次就会出现在这里</div></div>`;
  }
  const fbRows = data.feedback.map((f, i) => `
    <div class="sum-row">
      <div class="sum-row-head"><span class="sum-pill ${SUM_FB_PILL[f.state] || 's-first'}">${f.state}</span><span class="sum-action">${esc(f.action)}</span></div>
      <div class="sum-text">${esc(ai ? ai.feedback[i].text : localFbText(f))}</div>
    </div>`).join('');
  const tipRows = data.tips.map((t, i) => `
    <div class="sum-row">
      <div class="sum-row-head"><span class="sum-pill ${t.kind === '恢复' ? 'k-rec' : 'k-freq'}">${t.kind}</span><span class="sum-tip">${esc(ai ? ai.tips[i].text : t.text)}</span></div>
    </div>`).join('');
  return `<div class="card sum-card">${head}
    ${data.feedback.length ? `<div class="sum-cap">状态反馈</div><div class="sum-list">${fbRows}</div>` : ''}
    ${data.tips.length ? `<div class="sum-cap">频率与恢复</div><div class="sum-list">${tipRows}</div>` : ''}
  </div>`;
}

let sumAIPending = null;   // {fp, promise} 在飞请求（按指纹去重，避免 visibility 频繁触发重复发请求）
let sumAILastFail = 0;     // 失败后 60s 内不重复请求（静默）

function watchAIPending(pending) {
  pending.promise.then(result => {
    const cur = buildSummary();
    const curFp = sumFingerprint(cur);
    if (curFp !== pending.fp) return; // 数据已变：不写缓存不回填，新渲染会重新请求
    writeSummaryAICache(curFp, result);
    const box = $('#home-summary-card');
    if (box) box.innerHTML = sumCardHTML(cur, result);
  }).catch(() => {
    sumAILastFail = Date.now(); // 静默降级：保留本地模板文案，不弹 Toast
  });
}

function renderSummary() {
  const box = $('#home-summary-card');
  if (!box) return;
  const data = buildSummary();
  const fp = sumFingerprint(data);
  const ai = readSummaryAICache(fp);
  box.innerHTML = sumCardHTML(data, ai);
  // LLM 已配置、当日无匹配缓存、且不在失败静默期 → 后台请求 AI 文案，成功后静默回填
  if (!sumAIAvailable() || ai) return;
  if (Date.now() - sumAILastFail <= SUM_AI_RETRY_GAP) return;
  if (!sumAIPending || sumAIPending.fp !== fp) {
    sumAIPending = { fp, promise: fetchAISummaryCopy(data) };
  }
  watchAIPending(sumAIPending);
}

// 回到浏览器标签页时重算（页面 show/visibility 实时聚合）
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && document.body.dataset.tab === 'home' && !document.body.classList.contains('sub-open')) {
    renderSummary();
  }
});
