'use strict';
/* SQLite 数据层（better-sqlite3）
   设计要点：
   - 单表 items 存全部集合：collection + item_key 联合主键，data 存整条记录的 JSON
     → 字段名/类型/顺序与旧 JSON 文件完全一致，GET 直接回吐原对象，前端零改动
   - item_key 由 repo.itemKey() 统一推导（与迁移脚本共用同一套规则，保证幂等）
   - WAL + 同步事务：单机单进程足够，读写并发安全，无外部依赖 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');

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

let db = null;

function open() {
  if (db) return db;
  fs.mkdirSync(path.dirname(config.DB_PATH), { recursive: true });
  const isNewFile = !fs.existsSync(config.DB_PATH);
  db = new Database(config.DB_PATH);
  if (isNewFile) {
    // 新库先用 MEMORY 日志模式完成建表（不生成回滚日志文件），再切到 WAL。
    // 兼容「禁止删除临时文件」的受限文件系统（部分沙箱/网络盘）：否则首次写入会报 SQLITE_IOERR_DELETE
    try {
      db.pragma('journal_mode = MEMORY');
    } catch (e) {
      /* 忽略：以默认日志模式继续 */
    }
  }
  try {
    db.pragma('journal_mode = WAL'); // 读写并发：写不阻塞读
  } catch (e) {
    console.warn('[db] 启用 WAL 失败，改用默认日志模式：', e.message);
  }
  db.pragma('synchronous = NORMAL'); // WAL 下兼顾安全与性能
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

function get() {
  return db || open();
}

/* 事务包装：better-sqlite3 同步事务，异常自动回滚 */
function tx(fn) {
  return get().transaction(fn)();
}

function close() {
  if (!db) return;
  const handle = db;
  db = null;

  // 先把 WAL 全量落盘到主库文件。
  // WAL 模式下关闭最后一个连接时，SQLite 会尝试删除 -wal/-shm 文件；
  // 某些受限文件系统（沙箱、网络盘、只读挂载）禁止删除 → 抛 SQLITE_IOERR_DELETE。
  // 提前 checkpoint 可保证数据已完整写入主库，残留的 -wal 文件下次打开时会被自动恢复/清理。
  try {
    handle.pragma('wal_checkpoint(TRUNCATE)');
  } catch (e) {
    console.warn('[db] WAL checkpoint 失败（数据仍由 WAL 保障，下次启动自动恢复）：', e.message);
  }

  try {
    handle.close();
  } catch (e) {
    console.warn('[db] 关闭数据库时清理 WAL 文件被拒绝，已忽略（数据已 checkpoint）：', e.message);
  }
}

module.exports = { open, get, tx, close, SCHEMA };
