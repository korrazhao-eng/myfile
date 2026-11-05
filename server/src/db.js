'use strict';
/* SQLite 数据层
   ────────────────────────────────────────────────────────────────
   设计要点：
   - 单表 items 存全部集合：collection + item_key 联合主键，data 存整条记录的 JSON
     → 字段名/类型/顺序与旧 JSON 文件完全一致，GET 直接回吐原对象，前端零改动
   - item_key 由 repo.itemKey() 统一推导（与迁移脚本共用同一套规则，保证幂等）
   - 驱动：优先 better-sqlite3，原生绑定不可用时自动回退 Node 内置 node:sqlite
     （见 src/sqlite-driver.js），业务层无感知
   - 日志模式：WAL 优先，不可用时依次回退 TRUNCATE / MEMORY（单机单进程够用）

   启动流程（open）：
     ① 选驱动（子进程自检 better-sqlite3 原生绑定）
     ② 子进程自检「这个库文件 + 这个驱动 + 这个日志模式」能否真正读写
        → 不可用（常见于受限环境里的 WAL 库）→ 自动在同目录重建一个新库并搬数据
     ③ 建表 + 设定日志模式 + 打开连接
*/

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const config = require('./config');
const { selectDriver, openHandle } = require('./sqlite-driver');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS items (
  collection  TEXT    NOT NULL,
  item_key   TEXT    NOT NULL,
  ord        INTEGER NOT NULL DEFAULT 0,
  data       TEXT    NOT NULL,
  updated_at TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  PRIMARY KEY (collection, item_key)
);
CREATE INDEX IF NOT EXISTS idx_items_coll ON items (collection, ord);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
`;

const PROBE_DB_SCRIPT = path.join(__dirname, '..', 'scripts', 'probe-db.js');

let db = null;
let driverName = null;
let journalMode = null;

/* ---------- 启动自检 ---------- */

/**
 * 子进程自检库文件可用性。
 * @returns {{ok:boolean, mode?:string, created?:boolean, error?:string, signal?:string}}
 */
function probeDbFile(filePath, driver) {
  let out = '';
  try {
    const r = spawnSync(process.execPath, [PROBE_DB_SCRIPT, filePath, driver], {
      encoding: 'utf8',
      timeout: 30000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    out = (r.stdout || '').trim();
    if (out) {
      try {
        return JSON.parse(out.split('\n').pop());
      } catch (e) {
        /* 落到下面统一处理 */
      }
    }
    return { ok: false, error: r.error ? String(r.error.message) : `probe exited ${r.status}/${r.signal}` };
  } catch (e) {
    return { ok: false, error: String(e.message) };
  }
}

/** 读取旧库内容（只读方式打开，WAL 库在受限环境下读是安全的） */
function readOldRows(filePath) {
  const out = { items: [], meta: [] };
  let handle = null;
  try {
    const { DatabaseSync } = require('node:sqlite');
    handle = new DatabaseSync(filePath, { readOnly: true });
    try { out.items = handle.prepare('SELECT collection, item_key, ord, data FROM items').all(); } catch (e) { out.items = []; }
    try { out.meta = handle.prepare('SELECT key, value FROM meta').all(); } catch (e) { out.meta = []; }
  } catch (e) {
    out.error = String(e.message).slice(0, 120);
  } finally {
    try { if (handle) handle.close(); } catch (e) { /* ignore */ }
  }
  return out;
}

/** 把旧库的行搬进新库 */
function copyRows(handle, rows) {
  if (!rows.items.length && !rows.meta.length) return 0;
  handle.transaction(() => {
    for (const r of rows.items) {
      handle
        .prepare('INSERT OR REPLACE INTO items (collection, item_key, ord, data) VALUES (?, ?, ?, ?)')
        .run(r.collection, r.item_key, r.ord, r.data);
    }
    for (const r of rows.meta) {
      handle.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(r.key, r.value);
    }
  })();
  return rows.items.length;
}

/* ---------- 连接管理 ---------- */

/** 探测数据库目录是否允许删除文件（WAL 模式 close 时会删除 -wal/-shm） */
function canDeleteIn(dir) {
  const probe = path.join(dir, '.gym-delete-probe');
  try {
    fs.writeFileSync(probe, 'x');
  } catch (e) {
    return false;
  }
  try {
    fs.unlinkSync(probe);
    return true;
  } catch (e) {
    return false; // 受限环境：删除被拒绝（如沙箱的 safe-delete 守卫）
  }
}

function open() {
  if (db) return db;

  fs.mkdirSync(path.dirname(config.DB_PATH), { recursive: true });

  // ① 选驱动
  const picked = selectDriver(config.DB_PATH, config.DB_DRIVER);
  driverName = picked.name;
  console.log(`[db] 驱动 ${driverName}（${picked.reason}）`);

  // ② 自检库文件；不可用则自动重建到同目录的新文件
  let target = config.DB_PATH;
  let probe = probeDbFile(target, driverName);
  if (!probe.ok) {
    const rebuilt = `${target}.rebuilt`;
    console.warn(`[db] 当前库文件不可用（${probe.error || '未知原因'}），将在 ${path.basename(rebuilt)} 中重建`);
    const oldRows = fs.existsSync(target) ? readOldRows(target) : { items: [], meta: [] };
    const probe2 = probeDbFile(rebuilt, driverName);
    if (!probe2.ok) throw new Error(`数据库重建失败：${probe2.error || '未知原因'}`);
    target = rebuilt;
    probe = probe2;
    config.DB_PATH = rebuilt;
    db = openHandle(target, driverName);
    db.exec(SCHEMA);
    const moved = copyRows(db, oldRows);
    if (moved) console.log(`[db] 已从旧库搬迁 ${moved} 条记录`);
  } else {
    db = openHandle(target, driverName);
  }

  // ③ 日志模式与基础 pragma
  journalMode = probe.mode || 'WAL';
  try { db.pragma(`journal_mode = ${journalMode}`); } catch (e) { /* 已是该模式，忽略 */ }
  try { db.pragma('synchronous = NORMAL'); } catch (e) { /* ignore */ }
  try { db.pragma('foreign_keys = ON'); } catch (e) { /* ignore */ }
  db.exec(SCHEMA);

  console.log(`[db] 日志模式 ${journalMode}｜文件 ${target}`);
  return db;
}

function get() {
  return db || open();
}

/* 事务包装：better-sqlite3 与 node:sqlite 适配层都提供 transaction(fn)() */
function tx(fn) {
  return get().transaction(fn)();
}

/**
 * 关闭数据库。
 * 先把 WAL 内容 checkpoint 回主库文件；再按「当前文件系统是否允许删除文件」决定
 * 是否真正 close —— WAL 模式下 close 会尝试删除 -wal/-shm，受限环境里可能触发
 * 进程强杀，因此此时只 checkpoint 不 close（残留文件下次启动会被 SQLite 自动恢复）。
 */
function close() {
  if (!db) return;
  const handle = db;
  db = null;
  try {
    handle.pragma('wal_checkpoint(TRUNCATE)');
  } catch (e) {
    console.warn('[db] WAL checkpoint 失败（数据仍由 WAL 保障，下次启动自动恢复）：', e.message);
  }
  const isWal = String(journalMode || '').toUpperCase() === 'WAL';
  if (isWal && !canDeleteIn(path.dirname(config.DB_PATH))) {
    // WAL 模式下 close() 会删除 -wal/-shm；受限文件系统里删除被拒绝甚至会强杀进程，
    // 因此只做 checkpoint 不 close —— 残留文件下次启动会被 SQLite 自动恢复。
    console.warn('[db] 当前文件系统不允许删除文件，跳过 close（WAL 残留文件将在下次启动自动恢复）');
    return;
  }
  try {
    handle.close();
  } catch (e) {
    console.warn('[db] 关闭数据库时清理附属文件被拒绝，已忽略（数据已 checkpoint）：', e.message);
  }
}

module.exports = {
  open,
  get,
  tx,
  close,
  SCHEMA,
  get driverName() { return driverName; },
  get journalMode() { return journalMode; },
};
