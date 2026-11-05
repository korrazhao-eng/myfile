'use strict';
/* 集合仓储层：把「旧模拟后端 data/*.json + 线程锁」的行为映射到 SQLite
   —— 集合语义完全对齐 docs/api.md：
   1. coaches/equipments/users：有 id 的 CRUD 集合；POST 生成 8 位 id
   2. profile/plans：仅 PUT + JSON 数组（全量替换），其余方法 405
   3. logs/lessons：POST 按 date upsert（同日覆盖整条），GET 支持 ?date= / ?coach=
   4. equipments：读取时缺 muscles/subMuscles → 按内置默认表补全并写回（幂等） */

const crypto = require('crypto');
const db = require('./db');
const { EQUIP_MUSCLES, EQUIP_SUB } = require('./defaults');

/* 契约中的 7 个集合 + bootstrap 聚合 */
const COLLECTIONS = ['coaches', 'equipments', 'profile', 'users', 'logs', 'lessons', 'plans'];
/* 有 id 的 CRUD 集合（GET 单条 / PUT / DELETE 走 id） */
const ID_COLLECTIONS = ['coaches', 'equipments', 'users'];
/* 仅支持 PUT + 数组 body 的全量替换集合 */
const FULL_REPLACE_ONLY = ['profile', 'plans'];
/* POST 按 date upsert 的上报集合 */
const DATE_UPSERT = ['logs', 'lessons'];
/* 管理端管理的集合（写操作需 ADMIN_TOKEN）；logs/lessons 为用户端上报，保持开放 */
const ADMIN_MANAGED = ['coaches', 'equipments', 'users', 'profile', 'plans'];

const isCollection = (name) => COLLECTIONS.includes(name);

/** 生成 8 位十六进制 id（与旧实现 uuid4().hex[:8] 同形） */
function newId() {
  return crypto.randomBytes(4).toString('hex');
}

/**
 * 计算记录在 items 表中的唯一键 —— 迁移脚本与运行时共用，保证幂等。
 *  - coaches/equipments/users → id:<记录 id>
 *  - logs/lessons 有 date    → date:<日期>（即「按 date upsert」的落库键）
 *  - logs/lessons 无 date    → id:<记录 id>（旧实现此时退化为普通追加）
 *  - plans 有 id              → id:<方案 id>；profile 无 id → idx:<下标>
 */
function itemKey(collection, record, index) {
  if (collection === 'logs' || collection === 'lessons') {
    if (record && typeof record.date === 'string' && record.date !== '') return `date:${record.date}`;
  }
  if (record && typeof record.id === 'string' && record.id !== '') return `id:${record.id}`;
  return `idx:${index == null ? 0 : index}`;
}

/** 读取集合（按 ord 升序 = 数组顺序） */
function list(collection) {
  const rows = db.get()
    .prepare('SELECT data FROM items WHERE collection = ? ORDER BY ord ASC, rowid ASC')
    .all(collection);
  return rows.map((r) => JSON.parse(r.data));
}

/** 读取集合条数 */
function count(collection) {
  return db.get().prepare('SELECT COUNT(*) AS n FROM items WHERE collection = ?').get(collection).n;
}

/**
 * 按记录里的 id 字段查找（契约语义：PUT/DELETE/GET 单条都按记录 id 定位）
 * 返回 { record, key }：key 用于后续写回/删除（logs/lessons 的键是 date:<日期>）
 */
function findEntryById(collection, id) {
  const rows = db.get()
    .prepare('SELECT item_key, data FROM items WHERE collection = ? ORDER BY ord ASC, rowid ASC')
    .all(collection);
  let dateHit = null;
  for (const row of rows) {
    const rec = JSON.parse(row.data);
    if (!rec) continue;
    if (rec.id === id) return { record: rec, key: row.item_key };
    // logs/lessons 落库键为 date:<日期> 且记录无 id 字段：URL 的 id 段同时支持按 date 定位
    if (DATE_UPSERT.includes(collection) && rec.date === id) dateHit = { record: rec, key: row.item_key };
  }
  return dateHit;
}

/** 按 id 取单条（仅 id 集合） */
function findById(collection, id) {
  const hit = findEntryById(collection, id);
  return hit ? hit.record : null;
}

/** 按 key 取单条 */
function findByKey(collection, key) {
  const row = db.get().prepare('SELECT data FROM items WHERE collection = ? AND item_key = ?').get(collection, key);
  return row ? JSON.parse(row.data) : null;
}

/** 生成库内唯一键：与既有记录冲突时追加 #n 后缀（保留记录自身 id 语义，与旧实现「允许重复 id」一致） */
function uniqueKey(collection, baseKey) {
  const exists = db.get().prepare('SELECT 1 FROM items WHERE collection = ? AND item_key = ?');
  if (!exists.get(collection, baseKey)) return baseKey;
  for (let n = 2; n < 10000; n++) {
    const k = `${baseKey}#${n}`;
    if (!exists.get(collection, k)) return k;
  }
  return `${baseKey}#${Date.now()}`;
}

/** 全量替换集合（profile/plans PUT、迁移脚本导入用） */
function replaceAll(collection, records) {
  const del = db.get().prepare('DELETE FROM items WHERE collection = ?');
  const ins = db.get().prepare(
    'INSERT INTO items (collection, item_key, ord, data) VALUES (?, ?, ?, ?)'
  );
  db.tx(() => {
    del.run(collection);
    records.forEach((rec, i) => {
      ins.run(collection, uniqueKey(collection, itemKey(collection, rec, i)), i, JSON.stringify(rec));
    });
  });
  return records.length;
}

/** 新增一条（追加到末尾） */
function insert(collection, record) {
  const ord = db.get().prepare('SELECT COALESCE(MAX(ord), -1) + 1 AS n FROM items WHERE collection = ?').get(collection).n;
  const key = uniqueKey(collection, itemKey(collection, record, ord));
  db.get()
    .prepare('INSERT INTO items (collection, item_key, ord, data) VALUES (?, ?, ?, ?)')
    .run(collection, key, ord, JSON.stringify(record));
  return key;
}

/** 按 key 覆盖一条（保留原有排序位置） */
function updateByKey(collection, key, record) {
  db.get().prepare('UPDATE items SET data = ?, updated_at = datetime(\'now\',\'localtime\') WHERE collection = ? AND item_key = ?')
    .run(JSON.stringify(record), collection, key);
}

/** 按 key 删除一条，返回是否命中 */
function removeByKey(collection, key) {
  const info = db.get().prepare('DELETE FROM items WHERE collection = ? AND item_key = ?').run(collection, key);
  return info.changes > 0;
}

/**
 * equipments 加载兜底：记录缺 muscles/subMuscles 时按内置默认表补全并写回（幂等，无需手工迁移）
 * —— 语义与旧实现一致：只判断「字段是否存在」，空数组视为已配置
 */
function completeEquipMuscles() {
  const rows = db.get().prepare("SELECT item_key, data FROM items WHERE collection = 'equipments'").all();
  const upd = db.get().prepare("UPDATE items SET data = ?, updated_at = datetime('now','localtime') WHERE collection = 'equipments' AND item_key = ?");
  let changed = 0;
  db.tx(() => {
    for (const row of rows) {
      const rec = JSON.parse(row.data);
      let dirty = false;
      if (!Object.prototype.hasOwnProperty.call(rec, 'muscles')) {
        rec.muscles = EQUIP_MUSCLES[rec.id] || [];
        dirty = true;
      }
      if (!Object.prototype.hasOwnProperty.call(rec, 'subMuscles')) {
        rec.subMuscles = EQUIP_SUB[rec.id] || [];
        dirty = true;
      }
      if (dirty) {
        upd.run(JSON.stringify(rec), row.item_key);
        changed++;
      }
    }
  });
  return changed;
}

/** 读取集合前的统一预处理（仅 equipments 需要补全） */
function prepareRead(collection) {
  if (collection === 'equipments') completeEquipMuscles();
}

/** 首次启动播种：集合为空且无存量数据时用内置默认值初始化 */
function seedIfEmpty(collection, records) {
  if (count(collection) > 0) return 0;
  replaceAll(collection, records);
  return records.length;
}

module.exports = {
  COLLECTIONS,
  ID_COLLECTIONS,
  FULL_REPLACE_ONLY,
  DATE_UPSERT,
  ADMIN_MANAGED,
  isCollection,
  newId,
  itemKey,
  list,
  count,
  findById,
  findEntryById,
  findByKey,
  replaceAll,
  insert,
  updateByKey,
  removeByKey,
  completeEquipMuscles,
  prepareRead,
  seedIfEmpty,
};
