'use strict';
/* Express 应用装配
   路由顺序：/api/llm → /api → /proxy → 静态托管 → 404
   统一约定：
   - 所有响应带 Cache-Control: no-cache, no-store, must-revalidate
   - JSON 响应 UTF-8；错误统一 {"error": "<原因>"}
   - 静态托管根目录 = gym-app/（与旧 serve.py 行为一致：/ → index.html，/admin.html → 管理后台） */

const express = require('express');
const path = require('path');
const config = require('./config');
const { applyCommonHeaders, sendError, rawBody } = require('./http');
const apiRouter = require('./routes/api');
const llmRouter = require('./routes/llm');
const proxyRouter = require('./routes/proxy');

/** 轻量 Cookie 解析（避免为 2 行代码引入额外依赖） */
function cookieParser(req, res, next) {
  const header = req.headers.cookie;
  req.cookies = {};
  if (header) {
    for (const part of header.split(';')) {
      const idx = part.indexOf('=');
      if (idx < 0) continue;
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      if (!k) continue;
      try {
        req.cookies[k] = decodeURIComponent(v);
      } catch (e) {
        req.cookies[k] = v;
      }
    }
  }
  next();
}

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('query parser', 'simple');
  app.set('etag', false); // 禁用 ETag，避免 304 与 no-cache 语义冲突

  // ① 统一响应头（禁用缓存）
  app.use((req, res, next) => {
    applyCommonHeaders(res);
    next();
  });

  // ② 原始 body 缓冲（自行解析 JSON，精确控制 400 语义）
  app.use(rawBody());
  app.use(cookieParser);

  // ③ 管理后台页：下发管理 Token Cookie（前端零改动即可通过鉴权）
  app.get(['/admin.html', '/admin', '/admin/'], (req, res, next) => {
    if (config.ADMIN_TOKEN) {
      res.cookie('gym_admin_token', config.ADMIN_TOKEN, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 7 * 24 * 3600 * 1000,
      });
    }
    next();
  });

  // ④ Trae 预览面板注入的 HMR 客户端：回空脚本避免控制台 404
  app.get('/@vite/*', (req, res) => {
    res.set('Content-Type', 'application/javascript; charset=utf-8');
    res.send('/* vite-client stub */');
  });

  // ⑤ 业务接口（/api/llm 必须在 /api 之前，否则会被 /api/:coll 捕获）
  app.use('/api/llm', llmRouter);
  app.use('/api', apiRouter);

  // ⑥ 上游透传代理（百度识图 / 兼容旧 /proxy/llm）
  app.use('/proxy', proxyRouter);

  // ⑦ 私有配置保护：*.local.js 只允许本机回环访问
  //    该文件会被 index.html 直接 <script> 加载，但绝不能被局域网/公网取走（内含 Key）
  app.use((req, res, next) => {
    if (!/\.local\.js$/i.test(req.path)) return next();
    const remote = ((req.socket && req.socket.remoteAddress) || '').replace(/^::ffff:/, '');
    // 无地址（unix socket）视为本机；仅放行 IPv4/IPv6 回环
    if (!remote || remote === '127.0.0.1' || remote === '::1') return next();
    return sendError(res, 403, 'forbidden');
  });

  // ⑧ 静态托管（index.html / admin.html / js / css / icons）
  app.use(
    express.static(config.STATIC_ROOT, {
      index: 'index.html',
      redirect: false,
      setHeaders: (res) => {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      },
    })
  );

  // ⑨ 兜底 404（契约：未知集合 / id 不存在 / 静态 404 统一 404 + {"error":...}）
  app.use((req, res) => sendError(res, 404, 'not found'));

  // ⑩ 错误处理（含 body 解析失败 / 请求体超限）
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err.status || err.statusCode || 500;
    if (err.type === 'entity.parse.failed') {
      return sendError(res, 400, 'invalid json body');
    }
    if (err.type === 'entity.too.large') {
      return sendError(res, 413, 'payload too large');
    }
    return sendError(res, status >= 400 && status < 600 ? status : 500, err.message || 'internal error');
  });

  return app;
}

module.exports = { createApp };
