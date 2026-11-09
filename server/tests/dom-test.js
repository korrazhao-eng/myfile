#!/usr/bin/env node
'use strict';
/* =============================================================================
 * DOM 契约基线测试
 *
 * 目的：证明「前端切换真实 API」这一轮改动**没有动 DOM 结构**——
 *       index.html / admin.html 的元素 id 集合、css/、icons/ 全部保持原样。
 *
 * 检查项：
 *   ① index.html 与 admin.html 的 id 集合与基线文件一致（无新增/无删除）
 *   ② js/app.js 与 js/admin.js 引用的所有 #id 都存在于对应 HTML 中（无悬空引用）
 *   ③ css/ 与 icons/ 目录的文件清单与内容指纹与基线一致
 *
 * 基线文件：server/tests/dom-baseline.json
 *   —— 由 `node tests/dom-test.js --update` 生成（仅在确知 HTML 结构变更时才应重生成）
 *
 * 用法：
 *   node tests/dom-test.js            # 校验
 *   node tests/dom-test.js --update   # 重新生成基线
 * 退出码：0 = 通过；1 = 有差异
 * ============================================================================= */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const BASELINE_PATH = path.join(__dirname, 'dom-baseline.json');

let pass = 0, fail = 0;
const failures = [];
function ok(n) { pass++; console.log(`  ✓ ${n}`); }
function bad(n, d) { fail++; failures.push({ n, d }); console.log(`  ✗ ${n}\n      ${d}`); }
function assert(n, c, d) { c ? ok(n) : bad(n, d || '断言失败'); }
function section(t) { console.log(`\n${t}`); }

/* 提取 HTML 中所有 id="..." */
function extractIds(html) {
  const ids = [];
  const re = /\bid\s*=\s*["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(html))) ids.push(m[1]);
  return [...new Set(ids)].sort();
}

/* 提取 JS 里所有 $('#xxx') / querySelector('#xxx') 引用的 id */
function extractJsIdRefs(js) {
  const ids = new Set();
  const patterns = [
    /\$\(\s*['"]#([A-Za-z0-9_-]+)['"]\s*\)/g,
    /querySelector\(\s*['"]#([A-Za-z0-9_-]+)['"]\s*\)/g,
    /getElementById\(\s*['"]([A-Za-z0-9_-]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(js))) ids.add(m[1]);
  }
  return [...ids].sort();
}

/* 提取 JS 内嵌 HTML 模板中的 id（动态生成的元素，不在静态 HTML 里） */
function extractJsTemplateIds(js) {
  const ids = new Set();
  const re = /\bid\s*=\s*["']([A-Za-z0-9_-]+)["']/g;
  let m;
  while ((m = re.exec(js))) ids.add(m[1]);
  return [...ids].sort();
}

/* 目录指纹：文件清单 + 内容 sha256 */
function dirFingerprint(dir, filter) {
  if (!fs.existsSync(dir)) return null;
  const out = {};
  for (const f of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, f);
    if (!fs.statSync(full).isFile()) continue;
    if (filter && !filter(f)) continue;
    out[f] = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex').slice(0, 16);
  }
  return out;
}

function collect() {
  const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const adminHtml = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  const appJs = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
  const adminJs = fs.readFileSync(path.join(ROOT, 'js', 'admin.js'), 'utf8');
  return {
    indexIds: extractIds(indexHtml),
    adminIds: extractIds(adminHtml),
    appJsIds: extractJsIdRefs(appJs),
    adminJsIds: extractJsIdRefs(adminJs),
    /* JS 内嵌模板中动态生成的 id —— 与静态 HTML 合并后才是完整可达集合 */
    appJsTemplateIds: extractJsTemplateIds(appJs),
    adminJsTemplateIds: extractJsTemplateIds(adminJs),
    css: dirFingerprint(path.join(ROOT, 'css')),
    icons: dirFingerprint(path.join(ROOT, 'icons')),
  };
}

const cur = collect();

/* ---------------- --update：重生成基线 ---------------- */
if (process.argv.includes('--update')) {
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(cur, null, 2) + '\n');
  console.log(`已更新基线 → ${BASELINE_PATH}`);
  console.log(`  index.html id: ${cur.indexIds.length} 个`);
  console.log(`  admin.html id: ${cur.adminIds.length} 个`);
  console.log(`  css/ ${Object.keys(cur.css || {}).length} 个文件`);
  console.log(`  icons/ ${Object.keys(cur.icons || {}).length} 个文件`);
  process.exit(0);
}

/* ---------------- 校验 ---------------- */
if (!fs.existsSync(BASELINE_PATH)) {
  console.error(`缺少基线文件 ${BASELINE_PATH}\n请先执行：node tests/dom-test.js --update`);
  process.exit(2);
}
const base = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));

console.log('DOM 契约基线测试（验证 HTML/CSS/图标零改动 + JS 引用无悬空）');

/* ① id 集合一致 */
section('① HTML id 集合与基线一致');
{
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const diff = (a, b) => {
    const added = a.filter((x) => !b.includes(x));
    const removed = b.filter((x) => !a.includes(x));
    return { added, removed };
  };
  const d1 = diff(cur.indexIds, base.indexIds);
  assert('index.html id 集合零增删', same(cur.indexIds, base.indexIds),
    d1.added.length || d1.removed.length ? `新增 ${JSON.stringify(d1.added)}，删除 ${JSON.stringify(d1.removed)}` : '');
  console.log(`      index.html 当前 ${cur.indexIds.length} 个 id（基线 ${base.indexIds.length} 个）`);

  const d2 = diff(cur.adminIds, base.adminIds);
  assert('admin.html id 集合零增删', same(cur.adminIds, base.adminIds),
    d2.added.length || d2.removed.length ? `新增 ${JSON.stringify(d2.added)}，删除 ${JSON.stringify(d2.removed)}` : '');
  console.log(`      admin.html 当前 ${cur.adminIds.length} 个 id（基线 ${base.adminIds.length} 个）`);
}

/* ② JS 引用无悬空（静态 HTML ∪ JS 内嵌模板动态生成的 id） */
section('② JS 引用的 #id 均存在于静态 HTML 或 JS 动态模板中');
{
  const indexSet = new Set([...cur.indexIds, ...cur.appJsTemplateIds]);
  const danglingApp = cur.appJsIds.filter((id) => !indexSet.has(id));
  assert('app.js 无悬空 id 引用', danglingApp.length === 0, '悬空: ' + JSON.stringify(danglingApp));
  console.log(`      app.js 引用 ${cur.appJsIds.length} 个 id，全部命中` +
    `（静态 ${cur.indexIds.length} + 动态模板 ${cur.appJsTemplateIds.length}）`);

  /* admin.js 的 id 可能同时存在于两个 HTML（共用组件），取并集判定 */
  const union = new Set([...cur.indexIds, ...cur.adminIds, ...cur.appJsTemplateIds, ...cur.adminJsTemplateIds]);
  const danglingAdmin = cur.adminJsIds.filter((id) => !union.has(id));
  assert('admin.js 无悬空 id 引用', danglingAdmin.length === 0, '悬空: ' + JSON.stringify(danglingAdmin));
  console.log(`      admin.js 引用 ${cur.adminJsIds.length} 个 id，全部命中`);
}

/* ③ css / icons 指纹一致 */
section('③ css/ 与 icons/ 文件清单与内容指纹一致');
{
  const cmp = (name, curF, baseF) => {
    const curKeys = Object.keys(curF || {}), baseKeys = Object.keys(baseF || {});
    const added = curKeys.filter((k) => !baseKeys.includes(k));
    const removed = baseKeys.filter((k) => !curKeys.includes(k));
    const changed = curKeys.filter((k) => baseKeys.includes(k) && curF[k] !== baseF[k]);
    assert(`${name} 零增删改`, !added.length && !removed.length && !changed.length,
      `新增 ${JSON.stringify(added)}，删除 ${JSON.stringify(removed)}，修改 ${JSON.stringify(changed)}`);
    console.log(`      ${name} ${curKeys.length} 个文件，指纹一致`);
  };
  cmp('css/', cur.css, base.css);
  cmp('icons/', cur.icons, base.icons);
}

console.log(`\n===== DOM 契约基线测试结果 =====`);
console.log(`  通过: ${pass}   失败: ${fail}`);
if (failures.length) {
  console.log('\n失败明细：');
  failures.forEach((f) => console.log(`  - ${f.n}: ${f.d}`));
}
console.log(fail ? '\n  存在差异 ✗' : '\n  全部通过 ✓');
process.exit(fail ? 1 : 0);
