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
   | LLM_ALLOWED_MODELS | 空 | 允许客户端指定的模型白名单（逗号分隔）；空=LLM_MODEL + glm-4-flash |
   | LLM_MAX_TOKENS | 1200 | 单次请求 max_tokens 上限（超出截断） |
   | LLM_RATE_LIMIT | 10 | 每 IP 每分钟最大请求数；0=不限 |
   | LLM_REQUIRE_ADMIN | 0 | 1=该接口也要求 ADMIN_TOKEN（智能助手仅管理端使用时开启） |
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
  LLM_ALLOWED_MODELS: (() => {
    const fromEnv = (process.env.LLM_ALLOWED_MODELS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (fromEnv.length) return fromEnv;
    // 默认：服务端模型 + 前端硬编码的 glm-4-flash，保证既有前端不改也能用
    return Array.from(new Set([(process.env.LLM_MODEL || 'glm-4-flash').trim(), 'glm-4-flash']));
  })(),
  LLM_MAX_TOKENS: num(process.env.LLM_MAX_TOKENS, 1200),
  LLM_RATE_LIMIT: num(process.env.LLM_RATE_LIMIT, 10),
  LLM_REQUIRE_ADMIN: process.env.LLM_REQUIRE_ADMIN === '1',
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
