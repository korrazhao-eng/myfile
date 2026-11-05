#!/usr/bin/env node
'use strict';
/* 数据库文件可用性自检 —— 必须以**独立子进程**运行。
   目的：在不惊动主进程的前提下，确认「这个库文件 + 这个驱动 + 这个日志模式」
   能否真正完成一次读写。

   为什么需要它：受限运行环境（沙箱 / 只读挂载 / 拦截删除的系统调用）下，
   打开一个 WAL 库后写入可能直接触发进程被强杀（SIGKILL），主进程无法 try/catch。
   隔离到子进程后，主进程只会看到「子进程异常退出」，从而安全地切换到重建路径。

   用法： node scripts/probe-db.js <dbPath> <driver>
   输出： stdout 一行 JSON
     { ok: true, mode: "truncate", created: true }
     { ok: false, error: "..." } */

const fs = require('fs');
const path = require('path');
const { openHandle } = require('../src/sqlite-driver');

const dbPath = process.argv[2];
const driver = process.argv[3] || 'better-sqlite3';
const existed = fs.existsSync(dbPath);

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

let handle = null;
try {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  handle = openHandle(dbPath, driver);

  const modeRows = handle.pragma('journal_mode');
  const current = String((modeRows && modeRows[0] && modeRows[0].journal_mode) || '').toUpperCase();

  // 候选顺序：显式配置 → 库当前模式（仅 wal/truncate/memory，避免 delete 模式删日志文件）→ WAL → TRUNCATE → MEMORY
  const candidates = [];
  const push = (m) => { if (m && !candidates.includes(m)) candidates.push(m); };
  if (process.env.DB_JOURNAL_MODE) push(process.env.DB_JOURNAL_MODE.toUpperCase());
  if (['WAL', 'TRUNCATE', 'MEMORY'].includes(current)) push(current);
  push('WAL');
  push('TRUNCATE');
  push('MEMORY');

  let mode = null;
  let lastErr = null;
  for (const m of candidates) {
    try {
      handle.pragma(`journal_mode = ${m}`);
      // 真写一次再回滚：部分模式下「设置 pragma 成功」但「首次写入失败」
      handle.transaction(() => {
        handle.exec('CREATE TABLE IF NOT EXISTS _journal_probe (x INTEGER)');
        handle.prepare('INSERT INTO _journal_probe (x) VALUES (1)').run();
      })();
      mode = m;
      break;
    } catch (e) {
      lastErr = e;
      try { handle.exec('ROLLBACK'); } catch (e2) { /* ignore */ }
    }
  }

  if (!mode) {
    emit({ ok: false, error: lastErr ? String(lastErr.message).slice(0, 200) : 'no usable journal mode' });
    process.exit(1);
  }

  try { handle.exec('DROP TABLE IF EXISTS _journal_probe'); } catch (e) { /* ignore */ }
  emit({ ok: true, mode, created: !existed });
  // 刻意不调用 handle.close()：WAL 模式下的 close 会尝试删除 -wal/-shm 文件，
  // 受限环境里可能触发不可捕获的进程强杀。数据已落盘，交给操作系统回收句柄即可。
  process.exit(0);
} catch (e) {
  emit({ ok: false, error: String(e && e.message).slice(0, 200) });
  process.exit(1);
}
