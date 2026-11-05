'use strict';
/* 运行环境配置：全部通过环境变量覆盖，默认值零配置可跑（npm start 即用）
   | 变量 | 默认值 | 说明 |
   |---|---|---|
   | PORT | 8080 | 监听端口 |
   | HOST | 0.0.0.0 | 监听地址（设 127.0.0.1 则仅本机可访问） |
   | ADMIN_TOKEN | 空 | 管理端写操作 Token；为空=不开启鉴权（本地开发） |
   | ZHIPU_API_KEY | 空 | 智谱大模型 Key（服务端持有，不下发前端） |
   | ZHIPU_BASE_URL | https://open.bigmodel.cn/api/paas/v4 | 智谱 OpenAI 兼容接口基址 |
   | LLM_MODEL | glm-4-flash | /api/llm/summary 默认模型 |
   | BAIDU_UPSTREAM | https://aip.baidubce.com | /proxy/* 透传上游（百度智能云） |
   | DB_PATH | server/data/gym.db | SQLite 数据库文件 |
   | DB_DRIVER | auto | SQLite 驱动：auto / better-sqlite3 / node:sqlite（auto=优先 better-sqlite3，绑定不可用时回退 Node 内置） |
   | DB_JOURNAL_MODE | 空 | 日志模式：空=自动（WAL → TRUNCATE → MEMORY 依次尝试） |
   | STATIC_ROOT | gym-app/ | 静态托管根目录（与 serve.py 行为一致） |
   | LEGACY_DATA_DIR | gym-app/data | 存量 JSON 数据目录（迁移脚本读取） |
   | JSON_LIMIT | 10mb | 请求体大小上限 | */

const path = require('path');

const SERVER_ROOT = path.resolve(__dirname, '..');
const APP_ROOT = path.resolve(SERVER_ROOT, '..'); // gym-app/（静态托管根）

const num = (v, dflt) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
};

const config = {
  PORT: num(process.env.PORT, 8080),
  HOST: process.env.HOST || '0.0.0.0',
  ADMIN_TOKEN: (process.env.ADMIN_TOKEN || '').trim(),
  ZHIPU_API_KEY: (process.env.ZHIPU_API_KEY || '').trim(),
  ZHIPU_BASE_URL: (process.env.ZHIPU_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4').replace(/\/+$/, ''),
  LLM_MODEL: (process.env.LLM_MODEL || 'glm-4-flash').trim(),
  BAIDU_UPSTREAM: (process.env.BAIDU_UPSTREAM || 'https://aip.baidubce.com').replace(/\/+$/, ''),
  DB_PATH: process.env.DB_PATH || path.join(SERVER_ROOT, 'data', 'gym.db'),
  DB_DRIVER: (process.env.DB_DRIVER || 'auto').trim(),
  DB_JOURNAL_MODE: (process.env.DB_JOURNAL_MODE || '').trim(),
  STATIC_ROOT: process.env.STATIC_ROOT || APP_ROOT,
  LEGACY_DATA_DIR: process.env.LEGACY_DATA_DIR || path.join(APP_ROOT, 'data'),
  JSON_LIMIT: process.env.JSON_LIMIT || '10mb',
  SERVER_ROOT,
  APP_ROOT,
};

module.exports = config;
