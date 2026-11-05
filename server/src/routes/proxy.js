'use strict';
/* /proxy/* —— 上游透传（与旧实现 serve.py 行为一致）
   /proxy/*      → https://aip.baidubce.com/*   （百度识图：前端用 access_token 直连百度无 CORS 头，需经后端转发）
   /proxy/llm    → 智谱 chat/completions（兼容旧前端路径；新前端走 /api/llm/summary）
   透传：方法 / Body / Content-Type / Authorization 原样转发
   响应：上游状态码与 Content-Type 原样返回；网络异常 → 502 text/plain（契约 §3） */

const express = require('express');
const config = require('../config');
const { applyCommonHeaders } = require('../http');

const router = express.Router();
const UPSTREAM_TIMEOUT = Number(process.env.PROXY_TIMEOUT || 30000);

router.all('/*', async (req, res) => {
  const subPath = req.originalUrl.replace(/^\/proxy/, ''); // '/oauth/2.0/token?grant_type=...'
  const isLlm = req.path === '/llm' || req.path.startsWith('/llm/');
  const target = isLlm ? `${config.ZHIPU_BASE_URL}/chat/completions` : config.BAIDU_UPSTREAM + subPath;

  const headers = {};
  const ct = req.get('Content-Type');
  if (ct) headers['Content-Type'] = ct;
  const authHeader = req.get('Authorization');
  if (authHeader) headers.Authorization = authHeader;

  const hasBody = !['GET', 'HEAD'].includes(req.method) && req.body && req.body.length;

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? req.body : undefined,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT),
    });
    const buf = Buffer.from(await upstream.arrayBuffer());
    applyCommonHeaders(res);
    res.status(upstream.status);
    const upCt = upstream.headers.get('content-type');
    res.set('Content-Type', upCt || 'application/octet-stream');
    res.send(buf);
  } catch (err) {
    applyCommonHeaders(res);
    res.status(502).set('Content-Type', 'text/plain; charset=utf-8');
    res.send(String(err && err.message ? err.message : err));
  }
});

module.exports = router;
