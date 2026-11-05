'use strict';
/* 服务入口：初始化数据库 → 首次启动导入存量数据/播种默认值 → 启动 HTTP 服务 */

const config = require('./config');
const db = require('./db');
const repo = require('./repo');
const { DEFAULTS } = require('./defaults');
const { importLegacy, isDbEmpty } = require('./importer');
const { createApp } = require('./app');

function bootstrapData() {
  // ① 库完全为空 → 首次启动：自动导入存量 data/*.json（幂等，导入后库非空，不会重复导入）
  if (isDbEmpty()) {
    const res = importLegacy();
    const imported = Object.keys(res.collections);
    if (imported.length) {
      console.log(`[init] 已导入存量数据 ${res.dir} → ${imported.map((c) => `${c}(${res.collections[c]})`).join(', ')}`);
    }
  }
  // ② 仍为空的集合 → 用内置默认值播种（契约：数据缺失时自动初始化）
  for (const coll of repo.COLLECTIONS) {
    const seeded = repo.seedIfEmpty(coll, DEFAULTS[coll] || []);
    if (seeded) console.log(`[init] 播种默认数据 ${coll}(${seeded})`);
  }
}

function main() {
  try {
    db.open();
  } catch (e) {
    console.error(`启动失败：${e.message}`);
    process.exit(1);
  }
  bootstrapData();
  const app = createApp();
  const server = app.listen(config.PORT, config.HOST, () => {
    console.log(`健身器械助手后端已启动  http://${config.HOST}:${config.PORT}`);
    console.log(`  静态资源   ${config.STATIC_ROOT}`);
    console.log(`  数据库     ${config.DB_PATH}`);
    console.log(`  存储驱动   ${db.driverName}（日志模式 ${db.journalMode}）`);
    console.log(`  管理鉴权   ${config.ADMIN_TOKEN ? '已开启 (X-Admin-Token)' : '未开启 (ADMIN_TOKEN 未设置)'}`);
    console.log(`  LLM 代理   ${config.ZHIPU_API_KEY ? '已配置 (服务端持有 Key)' : '未配置 (ZHIPU_API_KEY 未设置)'}`);
  });

  const shutdown = (sig) => () => {
    console.log(`\n[${sig}] 正在关闭服务…`);
    let exited = false;
    const done = () => {
      if (exited) return;
      exited = true;
      try {
        db.close();
      } catch (e) {
        // 兜底：数据库关闭异常不应影响进程退出码
        console.warn('[exit] 关闭数据库时出现异常：', e.message);
      }
      process.exit(0);
    };
    server.close(done);
    // 兜底：连接未能在 3s 内排空（如 keep-alive 长连接）也强制退出
    setTimeout(done, 3000).unref();
  };
  process.on('SIGINT', shutdown('SIGINT'));
  process.on('SIGTERM', shutdown('SIGTERM'));
}

main();
