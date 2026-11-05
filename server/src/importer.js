'use strict';
/* 存量数据导入：gym-app/data/*.json → SQLite
   —— 供 scripts/migrate.js（一次性、幂等）与首次启动自动导入共用 */

const fs = require('fs');
const path = require('path');
const config = require('./config');
const repo = require('./repo');

/**
 * 导入全部存量集合（按集合整体替换 → 结果与 JSON 文件完全一致，重复执行幂等）
 * @returns {{dir:string, collections:Object, skipped:Array, missing:Array}}
 */
function importLegacy() {
  const dir = config.LEGACY_DATA_DIR;
  const result = { dir, collections: {}, skipped: [], missing: [] };
  if (!fs.existsSync(dir)) {
    result.missing.push(dir);
    return result;
  }
  for (const coll of repo.COLLECTIONS) {
    const file = path.join(dir, `${coll}.json`);
    if (!fs.existsSync(file)) {
      result.missing.push(coll);
      continue;
    }
    let data;
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      result.skipped.push({ collection: coll, error: e.message });
      continue;
    }
    if (!Array.isArray(data)) {
      result.skipped.push({ collection: coll, error: 'not an array' });
      continue;
    }
    result.collections[coll] = repo.replaceAll(coll, data);
  }
  return result;
}

/** 数据库是否完全为空（用于判定「首次启动」） */
function isDbEmpty() {
  const n = repo.COLLECTIONS.reduce((s, c) => s + repo.count(c), 0);
  return n === 0;
}

module.exports = { importLegacy, isDbEmpty };
