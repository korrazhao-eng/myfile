#!/usr/bin/env node
'use strict';
/* better-sqlite3 原生绑定自检 —— 必须以**独立子进程**运行。
   坏掉的原生绑定（ABI 不匹配 / 编译失败 / 被运行环境拦截）在本进程里可能直接
   触发不可捕获的崩溃，主进程无法 try/catch，因此隔离到子进程里做真实读写：
   退出码 0 = 可用；非 0 = 不可用（主进程据此回退到 node:sqlite）。 */

let db = null;
try {
  const Database = require('better-sqlite3');
  db = new Database(':memory:');
  db.exec('CREATE TABLE probe(k TEXT, v INTEGER)');
  db.prepare('INSERT INTO probe (k, v) VALUES (?, ?)').run('a', 1);
  const row = db.prepare('SELECT v FROM probe WHERE k = ?').get('a');
  db.close();
  db = null;
  if (!row || row.v !== 1) process.exit(2);
  process.exit(0);
} catch (e) {
  try { if (db) db.close(); } catch (e2) { /* ignore */ }
  process.exit(1);
}
