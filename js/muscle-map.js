/* 发力肌群可视化（V2.1 精细版）：SVG 人体肌肉模型（正面 + 背面双视图）
   - 后台按器械配置发力肌群（equipments.json 的 muscles 数组，中文名逗号分隔）
   - 本文件负责：中文名 → 模型区块匹配（MUSCLE_ALIASES，长名优先）+ 模型渲染 + 高亮
   - 用法：renderMuscleMap(container, ['背阔肌','菱形肌',...]) → 双视图 SVG，命中区块标红呼吸高亮
   - V2.1：肌块线性渐变（defs mmGrad/mmGradHot）+ 肌肉分块细节（束分裂线/六块腹/前锯肌/大圆肌/竖脊双柱/腓肠双头/两段式前臂） */
'use strict';

/* 本地转义兜底（正常情况复用 app.js 的 esc，避免对加载顺序产生硬依赖） */
const mmEsc = typeof esc === 'function' ? esc
  : s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* 中文别名 → 模型区块（一个名字可映射多个区块；匹配按别名长度降序，避免「斜方肌中下束」被「斜方肌」截胡） */
const MUSCLE_ALIASES = [
  ['胸大肌', 'chest'], ['胸', 'chest'],
  ['三角肌前束', 'delt_front'], ['前束', 'delt_front'],
  ['三角肌中束', 'delt_front'], ['中束', 'delt_front'],
  ['三角肌后束', 'delt_rear'], ['后束', 'delt_rear'],
  ['肩袖', 'delt_rear'],
  ['肱二头肌', 'biceps'], ['二头', 'biceps'],
  ['肱三头肌', 'triceps'], ['三头', 'triceps'],
  ['前臂屈肌', 'forearm_f'], ['前臂', 'forearm_f', 'forearm_b'],
  ['腹外斜', 'obliques'], ['侧腹', 'obliques'],
  ['腹肌', 'abs'], ['腹部', 'abs'], ['核心', 'abs'],
  ['背阔肌', 'lats'],
  ['菱形肌', 'rhomboids'],
  ['斜方肌上束', 'traps_up'], ['上斜方', 'traps_up'],
  ['斜方肌中下束', 'traps_mid'], ['中下斜方', 'traps_mid'], ['中斜方', 'traps_mid'], ['斜方肌', 'traps_mid'],
  ['竖脊肌', 'erector'], ['下背', 'erector'],
  ['前锯肌', 'serratus'],
  ['大圆肌', 'teres'],
  ['臀大肌', 'glutes'], ['臀部', 'glutes'], ['臀中肌', 'glute_med'],
  ['股四头肌', 'quads'], ['大腿前侧', 'quads'],
  ['腘绳肌', 'hamstrings'], ['大腿后侧', 'hamstrings'],
  ['腓肠肌', 'calves'], ['小腿', 'calves']
];

/* 单级匹配：中文名数组 → 命中区块 id 集合 + 图例项 [{name, ids}] */
function matchOne(names) {
  const hits = new Set(), legend = [];
  (names || []).forEach(raw => {
    const s = String(raw).trim();
    if (!s) return;
    const alias = MUSCLE_ALIASES.slice().sort((a, b) => b[0].length - a[0].length)
      .find(a => s.includes(a[0]));
    if (alias) {
      const ids = alias.slice(1);
      ids.forEach(id => hits.add(id));
      if (!legend.some(l => l.name === s)) legend.push({ name: s, ids });
    }
  });
  return { hits, legend };
}

/* 两级匹配：主发力（红）+ 辅助发力（橙） */
function matchMuscles(names, subNames) {
  const main = matchOne(names), sub = matchOne(subNames);
  return {
    hits: new Set([...main.hits, ...sub.hits]),
    legend: main.legend.map(l => ({ ...l, kind: 'main' })).concat(sub.legend.map(l => ({ ...l, kind: 'sub' })))
  };
}

/* 人体模型：defs 渐变 + base 骨架（不可高亮）+ 肌群块（data-m 供高亮选择器）+ 分块细节线（mm-line）。
   视图坐标：正面中心 x=85，背面中心 x=255，共同 viewBox 0 0 340 372 */
function bodySvg() {
  const M = (m, shape) => shape.replace('<path ', `<path data-m="${m}" `).replace('<ellipse ', `<ellipse data-m="${m}" `);
  const front = `
    <g class="mm-view" data-view="front">
      <!-- 头颈（骨架） -->
      <path class="mm-base" d="M85,13 C76,13 70,21 70,30 C70,36 72.5,41.5 77,45 L77,48 L93,48 L93,45 C97.5,41.5 100,36 100,30 C100,21 94,13 85,13 Z"/>
      <path class="mm-base" d="M80,49 L85,58 L90,49 Z"/>
      ${M('traps_up', '<path d="M62,57 Q85,47 108,57 L104,66 Q85,57 66,66 Z"/>')}
      <!-- 三角肌（前中束）：肩块 + 束分裂线 -->
      ${M('delt_front', '<path d="M50,68 C50,61 56,58 62,60 C69,62 72,66 71,74 C70,81 66,84 61,82 C55,80 50,75 50,68 Z"/>')}
      ${M('delt_front', '<path d="M120,68 C120,61 114,58 108,60 C101,62 98,66 99,74 C100,81 104,84 109,82 C115,80 120,75 120,68 Z"/>')}
      <path class="mm-line" d="M60,62 Q56,71 61,80"/><path class="mm-line" d="M110,62 Q114,71 109,80"/>
      <!-- 胸大肌：左右两块 + 中缝与下缘线 -->
      ${M('chest', '<path d="M84,63 C70,60 59,67 60,82 C61,92 70,97 78,95 C82,93.5 84,91 84,88 Z"/>')}
      ${M('chest', '<path d="M86,63 C100,60 111,67 110,82 C109,92 100,97 92,95 C88,93.5 86,91 86,88 Z"/>')}
      <path class="mm-line" d="M85,65 V89"/>
      <path class="mm-line" d="M63,80 Q73,84 83,80"/><path class="mm-line" d="M107,80 Q97,84 87,80"/>
      <!-- 前锯肌：肋侧锯齿小块 -->
      ${M('serratus', '<path d="M64,98 C62.5,105 63.5,112 66.5,118 L70,114 L67.5,107 L70,103 Z"/>')}
      ${M('serratus', '<path d="M106,98 C107.5,105 106.5,112 103.5,118 L100,114 L102.5,107 L100,103 Z"/>')}
      <!-- 肱二头肌 + 中线；两段式前臂（上臂段/腕段） -->
      ${M('biceps', '<ellipse cx="55" cy="101" rx="8.5" ry="15"/>')}
      ${M('biceps', '<ellipse cx="115" cy="101" rx="8.5" ry="15"/>')}
      <path class="mm-line" d="M55,91 V111"/><path class="mm-line" d="M115,91 V111"/>
      ${M('forearm_f', '<ellipse cx="49" cy="136" rx="8" ry="13"/>')}
      ${M('forearm_f', '<ellipse cx="121" cy="136" rx="8" ry="13"/>')}
      ${M('forearm_f', '<ellipse cx="47" cy="161" rx="6.5" ry="12"/>')}
      ${M('forearm_f', '<ellipse cx="123" cy="161" rx="6.5" ry="12"/>')}
      <ellipse class="mm-base" cx="45" cy="181" rx="5.5" ry="9"/>
      <ellipse class="mm-base" cx="125" cy="181" rx="5.5" ry="9"/>
      <!-- 腹直肌：外轮廓 + 竖中线 + 两条横线（六块感） -->
      ${M('abs', '<path d="M73,98 L97,98 L95.5,155 Q85,161 74.5,155 Z"/>')}
      <path class="mm-line" d="M85,99 V157"/>
      <path class="mm-line" d="M74.5,118 H95.5"/><path class="mm-line" d="M74.5,137 H95.5"/>
      <!-- 腹外斜 -->
      ${M('obliques', '<path d="M70,100 C66,111 66,130 71,149 L74.5,147 C70,130 70,112 72.5,101 Z"/>')}
      ${M('obliques', '<path d="M100,100 C104,111 104,130 99,149 L95.5,147 C100,130 100,112 97.5,101 Z"/>')}
      <!-- 骨盆（骨架） -->
      <path class="mm-base" d="M68,158 Q85,166 102,158 L99,180 Q85,188 71,180 Z"/>
      <!-- 股四头：主块 + 外侧分界线 + 内侧股内侧肌小块 -->
      ${M('quads', '<path d="M70,186 C62,200 60,225 64,250 L74,252 C79,228 80,204 81,188 Z"/>')}
      ${M('quads', '<path d="M100,186 C108,200 110,225 106,250 L96,252 C91,228 90,204 89,188 Z"/>')}
      ${M('quads', '<path d="M75,234 C74,243 75,249 78,252 L81,247 C80,242 79,238 78,234 Z"/>')}
      ${M('quads', '<path d="M95,234 C96,243 95,249 92,252 L89,247 C90,242 91,238 92,234 Z"/>')}
      <path class="mm-line" d="M66,196 Q62.5,222 65.5,246"/><path class="mm-line" d="M104,196 Q107.5,222 104.5,246"/>
      <ellipse class="mm-base" cx="70" cy="259" rx="7" ry="5"/>
      <ellipse class="mm-base" cx="100" cy="259" rx="7" ry="5"/>
      <!-- 小腿（胫前）两段 -->
      ${M('calves', '<ellipse cx="70" cy="283" rx="8" ry="17"/>')}
      ${M('calves', '<ellipse cx="100" cy="283" rx="8" ry="17"/>')}
      ${M('calves', '<ellipse cx="70" cy="310" rx="6" ry="11"/>')}
      ${M('calves', '<ellipse cx="100" cy="310" rx="6" ry="11"/>')}
      <path class="mm-base" d="M62,320 C64,318 76,318 78,320 L81,329 Q85,331 89,329 L92,320 C94,318 106,318 108,320 L108,328 Q85,334 62,328 Z"/>
      <text class="mm-tag" x="85" y="352" text-anchor="middle">正面</text>
    </g>`;
  const back = `
    <g class="mm-view" data-view="back">
      <path class="mm-base" d="M255,13 C246,13 240,21 240,30 C240,36 242.5,41.5 247,45 L247,48 L263,48 L263,45 C267.5,41.5 270,36 270,30 C270,21 264,13 255,13 Z"/>
      <path class="mm-base" d="M250,49 L255,58 L260,49 Z"/>
      <!-- 斜方肌上束（颈后大菱形）+ 中下束 -->
      ${M('traps_up', '<path d="M232,56 Q255,44 278,56 L271,81 Q255,68 239,81 Z"/>')}
      ${M('traps_mid', '<path d="M240,83 L270,83 L264,121 Q255,127 246,121 Z"/>')}
      <path class="mm-line" d="M244,86 L249,116"/><path class="mm-line" d="M266,86 L261,116"/>
      <!-- 三角肌后束 + 束分裂线 -->
      ${M('delt_rear', '<path d="M220,70 C220,63 226,60 232,62 C239,64 241,68 240,76 C239,83 235,86 230,84 C224,82 220,77 220,70 Z"/>')}
      ${M('delt_rear', '<path d="M290,70 C290,63 284,60 278,62 C271,64 269,68 270,76 C271,83 275,86 280,84 C286,82 290,77 290,70 Z"/>')}
      <path class="mm-line" d="M231,64 Q227,73 232,82"/><path class="mm-line" d="M279,64 Q283,73 278,82"/>
      <!-- 大圆肌：背阔上方小块 -->
      ${M('teres', '<path d="M243,84 C239,87 237,92 239,97 L245,94 L247,88 Z"/>')}
      ${M('teres', '<path d="M267,84 C271,87 273,92 271,97 L265,94 L263,88 Z"/>')}
      <!-- 菱形肌：脊柱旁双竖条 -->
      ${M('rhomboids', '<path d="M246,86 L250,86 L248,116 Z"/>')}
      ${M('rhomboids', '<path d="M264,86 L260,86 L262,116 Z"/>')}
      <!-- 背阔肌：V 型大块 + 翼缘线 -->
      ${M('lats', '<path d="M246,90 C234,94 227,112 230,133 C233,143 243,140 247,127 L247,96 Z"/>')}
      ${M('lats', '<path d="M264,90 C276,94 283,112 280,133 C277,143 267,140 263,127 L263,96 Z"/>')}
      <path class="mm-line" d="M240,100 C236,112 235,124 237,134"/><path class="mm-line" d="M270,100 C274,112 275,124 273,134"/>
      <!-- 肱三头肌（长头+外侧头）+ 两段式前臂 -->
      ${M('triceps', '<ellipse cx="224" cy="100" rx="8.5" ry="15"/>')}
      ${M('triceps', '<ellipse cx="286" cy="100" rx="8.5" ry="15"/>')}
      <path class="mm-line" d="M224,90 V110"/><path class="mm-line" d="M286,90 V110"/>
      ${M('forearm_b', '<ellipse cx="218" cy="136" rx="8" ry="13"/>')}
      ${M('forearm_b', '<ellipse cx="292" cy="136" rx="8" ry="13"/>')}
      ${M('forearm_b', '<ellipse cx="216" cy="161" rx="6.5" ry="12"/>')}
      ${M('forearm_b', '<ellipse cx="294" cy="161" rx="6.5" ry="12"/>')}
      <ellipse class="mm-base" cx="214" cy="181" rx="5.5" ry="9"/>
      <ellipse class="mm-base" cx="296" cy="181" rx="5.5" ry="9"/>
      <!-- 竖脊肌：脊柱旁双柱 -->
      ${M('erector', '<path d="M250.5,121 L254,121 L253,164 L250,164 Z"/>')}
      ${M('erector', '<path d="M256,121 L259.5,121 L260,164 L257,164 Z"/>')}
      <!-- 臀大肌：分块 + 中缝；臀中肌外侧小块 -->
      ${M('glutes', '<path d="M240,168 L270,168 C270,187 262,197 255,197 C248,197 240,187 240,168 Z"/>')}
      <path class="mm-line" d="M255,170 V196"/>
      <path class="mm-line" d="M243,182 Q249,186 253,184"/><path class="mm-line" d="M267,182 Q261,186 257,184"/>
      <ellipse data-m="glute_med" cx="233" cy="177" rx="7" ry="7"/>
      <ellipse data-m="glute_med" cx="277" cy="177" rx="7" ry="7"/>
      <!-- 腘绳肌：内外双柱 -->
      ${M('hamstrings', '<path d="M242,200 C237,222 239,244 244,256 L249,254 C248,232 248,214 248,200 Z"/>')}
      ${M('hamstrings', '<path d="M268,200 C273,222 271,244 266,256 L261,254 C262,232 262,214 262,200 Z"/>')}
      <path class="mm-line" d="M253,202 V252"/>
      <ellipse class="mm-base" cx="246" cy="259" rx="7" ry="5"/>
      <ellipse class="mm-base" cx="264" cy="259" rx="7" ry="5"/>
      <!-- 腓肠肌双头 + 跟腱 -->
      ${M('calves', '<ellipse cx="242" cy="281" rx="7.5" ry="16"/>')}
      ${M('calves', '<ellipse cx="268" cy="281" rx="7.5" ry="16"/>')}
      <path class="mm-base" d="M252,296 L258,296 L257,318 L253,318 Z"/>
      ${M('calves', '<ellipse cx="244" cy="308" rx="6" ry="10"/>')}
      ${M('calves', '<ellipse cx="266" cy="308" rx="6" ry="10"/>')}
      <path class="mm-base" d="M232,320 C234,318 246,318 248,320 L251,329 Q255,331 259,329 L262,320 C264,318 276,318 278,320 L278,328 Q255,334 232,328 Z"/>
      <text class="mm-tag" x="255" y="352" text-anchor="middle">背面</text>
    </g>`;
  return `<svg viewBox="0 0 340 372" class="mm-svg" role="img" aria-label="发力肌群人体模型示意">
    <style>
      /* 模型样式内嵌于 SVG：外部样式表里的 fill:url(#id) 会按 CSS 文件 URL 解析导致渐变失效，故必须随 SVG 走 */
      .mm-svg [data-m]{fill:url(#mmGrad);stroke:#3E4556;stroke-width:.8;transition:fill .3s,opacity .25s}
      .mm-svg .mm-base{fill:#232733;stroke:#2C3140;stroke-width:.8;transition:opacity .25s}
      .mm-svg .mm-line{fill:none;stroke:#4A5266;stroke-width:.7;stroke-linecap:round}
      .mm-svg .mm-tag{fill:#6E7580;font-size:11px}
      .mm-svg .mm-hot{fill:url(#mmGradHot);stroke:#FF9C91;filter:drop-shadow(0 0 5px rgba(232,86,78,.55));animation:mmPulse 2s ease-in-out infinite}
      .mm-svg [data-m].mm-subhot{fill:url(#mmGradSub);stroke:#FFC98F;filter:drop-shadow(0 0 4px rgba(240,150,60,.45));animation:mmPulse 2.4s ease-in-out infinite}
      /* 图例聚焦态：未聚焦肌群变暗，聚焦块保留呼吸光晕 */
      .mm-svg.mm-focusing [data-m]:not(.mm-focus){opacity:.18}
      .mm-svg.mm-focusing .mm-base{opacity:.3}
      @keyframes mmPulse{0%,100%{filter:drop-shadow(0 0 4px rgba(232,86,78,.4))}50%{filter:drop-shadow(0 0 8px rgba(232,86,78,.85))}}
      @media (prefers-reduced-motion: reduce){.mm-svg .mm-hot,.mm-svg .mm-subhot{animation:none}}
    </style>
    <defs>
      <linearGradient id="mmGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#384050"/><stop offset="1" stop-color="#282E3A"/></linearGradient>
      <linearGradient id="mmGradHot" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FF8577"/><stop offset="1" stop-color="#D24038"/></linearGradient>
      <linearGradient id="mmGradSub" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFC069"/><stop offset="1" stop-color="#E08426"/></linearGradient>
    </defs>${front}${back}</svg>`;
}

/* 渲染入口：container 填模型；主发力标红（mm-hot）、辅助标橙（mm-subhot）；
   legendEl 传图例容器时渲染可点击 chips（点击聚焦对应肌群，再点恢复），返回图例数组 */
function renderMuscleMap(container, names, subNames, legendEl) {
  const main = matchOne(names);
  const subAll = matchOne(subNames);
  /* 去重：同名肌群在主表已出现时，次表不再重复（区块与图例都只保留主级） */
  const mainNames = new Set(main.legend.map(l => l.name));
  const sub = { hits: new Set([...subAll.hits].filter(id => !main.hits.has(id))),
                legend: subAll.legend.filter(l => !mainNames.has(l.name)) };
  const legend = main.legend.map(l => ({ ...l, kind: 'main' })).concat(sub.legend.map(l => ({ ...l, kind: 'sub' })));
  const mainHits = main.hits, subHits = sub.hits;
  container.innerHTML = bodySvg();
  container.querySelectorAll('[data-m]').forEach(el => {
    if (mainHits.has(el.dataset.m)) el.classList.add('mm-hot');
    else if (subHits.has(el.dataset.m)) el.classList.add('mm-subhot');
  });
  if (legendEl) {
    legendEl.innerHTML = legend.length
      ? legend.map(l => `<i class="mm-chip${l.kind === 'sub' ? ' mm-chip-sub' : ''}" data-m="${mmEsc(l.ids.join(','))}">${mmEsc(l.name)}</i>`).join('')
      : '<span class="mm-none">未识别到发力肌群，请在后台补充</span>';
    const svg = container.querySelector('.mm-svg');
    legendEl.onclick = e => {
      const chip = e.target.closest('.mm-chip');
      if (!chip) return;
      const ids = (chip.dataset.m || '').split(',');
      const on = !chip.classList.contains('on');
      legendEl.querySelectorAll('.mm-chip').forEach(c => c.classList.toggle('on', c === chip && on));
      svg.classList.toggle('mm-focusing', on);
      container.querySelectorAll('[data-m]').forEach(el =>
        el.classList.toggle('mm-focus', on && ids.includes(el.dataset.m)));
    };
  }
  return legend;
}

window.renderMuscleMap = renderMuscleMap;
