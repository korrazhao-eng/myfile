'use strict';
/* /api/llm/* —— 智谱大模型代理（Key 下沉服务端）
   POST /api/llm/summary：接收 {messages}，服务端带 ZHIPU_API_KEY 转发智谱 OpenAI 兼容接口
   - Key 只存在服务端环境变量，不下发前端、不进日志
   - 上游错误：原样返回上游状态码（错误体统一为 {"error": "原因"}）
   - 网络异常：502（契约 §3/§4）
   GET  /api/llm/status：返回 Key 是否已配置（运维排查用） */

const express = require('express');
const config = require('../config');
const { sendJson, sendError, parseJsonBody } = require('../http');

const router = express.Router();
const UPSTREAM_TIMEOUT = Number(process.env.LLM_TIMEOUT || 30000);

router.get('/status', (req, res) => {
  sendJson(res, 200, {
    available: !!config.ZHIPU_API_KEY,
    model: config.LLM_MODEL,
    upstream: `${config.ZHIPU_BASE_URL}/chat/completions`,
  });
});

router.post('/summary', async (req, res) => {
  const { ok, value } = parseJsonBody(req);
  if (!ok || value === null) return sendError(res, 400, 'invalid json body');
  const body = value;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return sendError(res, 400, 'invalid json body');
  }
  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return sendError(res, 400, 'messages required');
  }
  if (!config.ZHIPU_API_KEY) {
    return sendError(res, 500, 'ZHIPU_API_KEY not configured');
  }

  const payload = {
    model: body.model || config.LLM_MODEL,
    messages,
    temperature: typeof body.temperature === 'number' ? body.temperature : 0.4,
    max_tokens: typeof body.max_tokens === 'number' ? body.max_tokens : 800,
    stream: false,
  };

  const target = `${config.ZHIPU_BASE_URL}/chat/completions`;
  try {
    const upstream = await fetch(target, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.ZHIPU_API_KEY}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT),
    });
    const text = await upstream.text();
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      parsed = null;
    }
    if (!upstream.ok) {
      const msg =
        (parsed && parsed.error && (parsed.error.message || parsed.error)) ||
        text ||
        'upstream error';
      return sendError(res, upstream.status, `llm upstream error: ${msg}`);
    }
    return sendJson(res, 200, parsed !== null ? parsed : { raw: text });
  } catch (err) {
    return sendError(res, 502, `llm upstream unavailable: ${err.message}`);
  }
});

module.exports = router;
