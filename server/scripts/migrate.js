#!/usr/bin/env node
'use strict';
/* 数据迁移脚本：把 gym-app/data/*.json 导入 SQLite（一次性、幂等）
   用法：
     npm run migrate                     # 导入 server/data/gym.db（默认）
     npm run migrate -- --db /path/db    # 指定数据库文件
     npm run migrate -- --data /path/dir # 指定存量 JSON 目录
   幂等性：按「集合整体替换」导入，重复执行结果一致（JSON 文件为导入的事实来源）；
   注意：导入会覆盖同名集合在库中的内容（如需保留运行期新增记录，请勿重复执行）。 */

const path = require('path');
const config = require('../src/config');
const db = require('../src/db');
const repo = require('../src/repo');
const { importLegacy } = require('../src/importer');

function parseArgs(argv) {
  const args = { db: null, data: null };
  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === '--db' || argv[i] === '-d') && argv[i + 1]) args.db = argv[++i];
    else if (argv[i] === '--data' && argv[i + 1]) args.data = argv[++i];
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.db) config.DB_PATH = path.resolve(args.db);
  if (args.data) config.LEGACY_DATA_DIR = path.resolve(args.data);

  console.log(`[migrate] 数据库   ${config.DB_PATH}`);
  console.log(`[migrate] 存量目录 ${config.LEGACY_DATA_DIR}`);

  db.open();
  const before = repo.COLLECTIONS.reduce((s, c) => s + repo.count(c), 0);
  const res = importLegacy();

  const imported = Object.entries(res.collections);
  if (!imported.length) {
    console.log('[migrate] 没有可导入的集合（存量目录为空或文件缺失）');
  }
  for (const [coll, n] of imported) {
    console.log(`[migrate] ✓ ${coll.padEnd(11)} 导入 ${n} 条`);
  }
  for (const miss of res.missing) {
    console.log(`[migrate] - 跳过（不存在）: ${miss}`);
  }
  for (const skip of res.skipped) {
    console.log(`[migrate] ! 跳过 ${skip.collection}: ${skip.error}`);
  }

  // 器械发力肌群兜底：缺 muscles/subMuscles 的记录按内置默认表补全（幂等）
  const fixed = repo.completeEquipMuscles();
  if (fixed) console.log(`[migrate] ✓ equipments 补全 muscles/subMuscles ${fixed} 条`);

  const after = repo.COLLECTIONS.reduce((s, c) => s + repo.count(c), 0);
  console.log(`[migrate] 完成：库内记录 ${before} → ${after}`);
  db.close();
}

main();
