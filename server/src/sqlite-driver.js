'use strict';
/* SQLite 驱动选择层
   ────────────────────────────────────────────────────────────────
   契约指定的存储栈是 better-sqlite3（server/package.json 依赖）。
   但原生绑定在真实环境中有三类常见故障，都会让「npm start」直接崩掉：
     ① Node 大版本切换后 ABI 不匹配（NODE_MODULE_VERSION 137 vs 127）→ ERR_DLOPEN_FAILED
     ② 未编译 / 编译失败（无网络、无 Python、缺工具链）
     ③ 受限运行环境拦截原生扩展的执行
   因此本层做两件事：
     1) 用**子进程**对 better-sqlite3 做一次真实读写自检（主进程不碰坏绑定，
        避免坏绑定在主进程内触发不可捕获的崩溃）；
     2) 自检通过 → 用 better-sqlite3；不通过 → 回退到 Node 内置的 node:sqlite
        （Node ≥ 22.5 自带，无需编译）。
   两个驱动对外暴露同一套 better-sqlite3 风格 API，上层业务代码无感知：
     prepare(sql).run(...)/get(...)/all(...) 、 exec(sql) 、 pragma(str) 、
     transaction(fn) 、 close()
*/

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PROBE_SCRIPT = path.join(__dirname, '..', 'scripts', 'probe-driver.js');

/* ---------- better-sqlite3 自检（子进程） ---------- */

/** better-sqlite3 原生绑定的指纹：用于缓存自检结果，避免每次启动都多起一个进程 */
function betterSqliteFingerprint() {
  try {
    const pkgPath = require.resolve('better-sqlite3/package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const bin = path.join(path.dirname(pkgPath), 'build', 'Release', 'better_sqlite3.node');
    const st = fs.statSync(bin);
    return `${pkg.version}|${process.versions.modules}|${st.size}|${Math.round(st.mtimeMs)}`;
  } catch (e) {
    return 'absent';
  }
}

/** 自检结果缓存文件（放在数据库同目录，绑定/Node 版本变化时自动失效） */
function cachePathFor(dbPath) {
  return path.join(path.dirname(dbPath), '.driver-probe.json');
}

function readCachedProbe(dbPath) {
  try {
    const raw = JSON.parse(fs.readFileSync(cachePathFor(dbPath), 'utf8'));
    if (raw && raw.fingerprint === betterSqliteFingerprint() && typeof raw.ok === 'boolean') return raw.ok;
  } catch (e) {
    /* 无缓存或损坏 → 重新自检 */
  }
  return null;
}

function writeCachedProbe(dbPath, ok) {
  try {
    fs.writeFileSync(
      cachePathFor(dbPath),
      JSON.stringify({ fingerprint: betterSqliteFingerprint(), ok, at: new Date().toISOString() })
    );
  } catch (e) {
    /* 缓存写不进去不影响启动 */
  }
}

/**
 * 在子进程里真实跑一遍 better-sqlite3 的读写。
 * 失败时重试一次：部分环境（安全扫描、受限沙箱）会在「首次加载原生扩展」时
 * 拦截一次，之后即恢复正常 —— 重试一次即可拿到稳定结论。
 * @returns {boolean} true=原生绑定可用
 */
function probeBetterSqlite() {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = spawnSync(process.execPath, [PROBE_SCRIPT], {
        encoding: 'utf8',
        timeout: 30000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      if (r.status === 0) return true;
    } catch (e) {
      /* 继续重试 */
    }
  }
  return false;
}

/**
 * 选出可用驱动。
 * @param {string} dbPath 数据库文件路径（用于自检缓存定位）
 * @param {string} [preferred] 强制指定驱动：'better-sqlite3' | 'node:sqlite' | 'auto'
 * @returns {{name:string, reason:string}}
 */
function selectDriver(dbPath, preferred) {
  const want = (preferred || 'auto').toLowerCase();

  if (want === 'node:sqlite') {
    if (!hasNodeSqlite()) throw new Error('DB_DRIVER=node:sqlite 但当前 Node 不支持 node:sqlite（需要 Node ≥ 22.5）');
    return { name: 'node:sqlite', reason: '由 DB_DRIVER 指定' };
  }

  const cached = want === 'auto' ? readCachedProbe(dbPath) : null;
  const ok = cached === null ? probeBetterSqlite() : cached;
  if (cached === null) writeCachedProbe(dbPath, ok);

  if (ok && want !== 'node:sqlite') {
    return { name: 'better-sqlite3', reason: cached === null ? '原生绑定自检通过' : '原生绑定自检通过（缓存）' };
  }
  if (want === 'better-sqlite3') {
    throw new Error(
      'DB_DRIVER=better-sqlite3 但原生绑定不可用；' +
      '请执行 npm rebuild better-sqlite3，或改用 DB_DRIVER=node:sqlite'
    );
  }
  if (!hasNodeSqlite()) {
    throw new Error(
      'better-sqlite3 原生绑定不可用，且当前 Node（' + process.version + '）不支持内置 node:sqlite；' +
      '请升级到 Node ≥ 22.5，或执行 npm rebuild better-sqlite3'
    );
  }
  return { name: 'node:sqlite', reason: 'better-sqlite3 原生绑定不可用，自动回退到 Node 内置 SQLite' };
}

function hasNodeSqlite() {
  try {
    require('node:sqlite');
    return true;
  } catch (e) {
    return false;
  }
}

/* ---------- node:sqlite → better-sqlite3 风格 API 适配 ---------- */

/** 过滤 Node 内置 SQLite 的实验特性告警（仅影响启动输出，不影响功能） */
function silenceSqliteExperimentalWarning() {
  const original = process.emitWarning;
  process.emitWarning = function (warning, ...rest) {
    const type = rest.find((r) => typeof r === 'string');
    const text = typeof warning === 'string' ? warning : (warning && warning.message) || '';
    if (type === 'ExperimentalWarning' && /SQLite/i.test(text)) return;
    return original.call(process, warning, ...rest);
  };
}

/**
 * 把 node:sqlite 的 DatabaseSync 包成 better-sqlite3 风格的句柄。
 * 事务用 BEGIN/COMMIT + SAVEPOINT 实现嵌套（与 better-sqlite3 行为一致）。
 */
function adaptNodeSqlite(raw) {
  let txDepth = 0;
  return {
    driverName: 'node:sqlite',
    raw,
    prepare(sql) {
      const stmt = raw.prepare(sql);
      return {
        run: (...args) => stmt.run(...args),
        get: (...args) => stmt.get(...args),
        all: (...args) => stmt.all(...args),
      };
    },
    exec(sql) {
      raw.exec(sql);
    },
    pragma(str) {
      const sql = 'PRAGMA ' + str;
      try {
        return raw.prepare(sql).all();
      } catch (e) {
        // 部分 PRAGMA 不能 prepare（如带参数的形式）→ 退回 exec
        raw.exec(sql);
        return [];
      }
    },
    transaction(fn) {
      return function tx(...args) {
        const outermost = txDepth === 0;
        const sp = `gym_sp_${txDepth}`;
        raw.exec(outermost ? 'BEGIN' : `SAVEPOINT ${sp}`);
        txDepth++;
        try {
          const result = fn.apply(this, args);
          txDepth--;
          raw.exec(outermost ? 'COMMIT' : `RELEASE ${sp}`);
          return result;
        } catch (err) {
          txDepth--;
          try {
            if (outermost) {
              raw.exec('ROLLBACK');
            } else {
              raw.exec(`ROLLBACK TO ${sp}`);
              raw.exec(`RELEASE ${sp}`);
            }
          } catch (e) {
            /* 回滚失败时保留原始异常 */
          }
          throw err;
        }
      };
    },
    close() {
      raw.close();
    },
  };
}

/**
 * 打开数据库文件，返回统一句柄。
 * @param {string} filePath 数据库文件路径
 * @param {string} driverName 'better-sqlite3' | 'node:sqlite'
 */
function openHandle(filePath, driverName) {
  if (driverName === 'node:sqlite') {
    silenceSqliteExperimentalWarning();
    const { DatabaseSync } = require('node:sqlite');
    return adaptNodeSqlite(new DatabaseSync(filePath));
  }
  const Database = require('better-sqlite3');
  const db = new Database(filePath);
  db.driverName = 'better-sqlite3';
  return db;
}

module.exports = { selectDriver, openHandle, probeBetterSqlite, betterSqliteFingerprint };
