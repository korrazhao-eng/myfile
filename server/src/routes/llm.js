'use strict';
/* /api/llm/* —— 智谱大模型代理（Key 下沉服务端）
   POST /api/llm/summary：接收 {messages}，服务端带 ZHIPU_API_KEY 转发智谱 OpenAI 兼容接口
   - Key 只存在服务端环境变量，不下发前端、不进日志
   - 模型白名单 + 载荷上限 + 每 IP 频控（防止额度被刷、被拿去跑高价模型）
   - 频控超限：429；LLM_REQUIRE_ADMIN=1 时要求 ADMIN_TOKEN
   - 上游错误：透传状态码（错误体统一为 {"error": "原因"}）；网络异常 502
   GET  /api/llm/status：仅返回 Key 是否已配置（不暴露上游地址与模型名） */

const express = require('express');
const config = require('../config');
const auth = require('../auth');
const { sendJson, sendError, parseJsonBody } = require('../http');

const router = express.Router();
const UPSTREAM_TIMEOUT = Number(process.env.LLM_TIMEOUT || 30000);

/* ---------------- 载荷上限（防止大包冲击上游） ---------------- */
const MAX_MESSAGES = 20;
const MAX_MESSAGE_CHARS = 4000;
const MAX_TOTAL_CHARS = 20000;
const ROLES = new Set(['system', 'user', 'assistant']);

/** @returns {string} 空串=通过，否则为错误原因 */
function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return 'messages required';
  if (messages.length > MAX_MESSAGES) return `too many messages (max ${MAX_MESSAGES})`;
  let total = 0;
  for (const m of messages) {
    if (!m || typeof m !== 'object' || Array.isArray(m)) return 'invalid message';
    if (!ROLES.has(m.role)) return 'invalid message role';
    if (typeof m.content !== 'string') return 'invalid message content';
    if (m.content.length > MAX_MESSAGE_CHARS) return `message too long (max ${MAX_MESSAGE_CHARS})`;
    total += m.content.length;
  }
  if (total > MAX_TOTAL_CHARS) return `payload too large (max ${MAX_TOTAL_CHARS} chars)`;
  return '';
}

/* ---------------- 每 IP 固定窗口频控 ----------------
   注意：若部署在反向代理之后，需在 app.js 设置 app.set('trust proxy', 1)，
        否则 req.ip 恒为代理地址，限流会退化成“全局限流” */
const RATE_WINDOW_MS = 60 * 1000;
const buckets = new Map();

function overLimit(ip) {
  if (!config.LLM_RATE_LIMIT) return false;
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b || now >= b.resetAt) {
    buckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  b.count += 1;
  return b.count > config.LLM_RATE_LIMIT;
}

const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [ip, b] of buckets) if (now >= b.resetAt) buckets.delete(ip);
}, RATE_WINDOW_MS);
if (sweeper.unref) sweeper.unref();

/* ---------------- 路由 ---------------- */

router.get('/status', (req, res) => {
  sendJson(res, 200, { available: !!config.ZHIPU_API_KEY });
});

router.post('/summary', async (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (overLimit(ip)) {
    res.set('Retry-After', String(RATE_WINDOW_MS / 1000));
    return sendError(res, 429, 'too many requests');
  }
  if (config.LLM_REQUIRE_ADMIN && !auth.check(req)) {
    return sendError(res, 401, 'unauthorized');
  }

  const { ok, value } = parseJsonBody(req);
  if (!ok || value === null) return sendError(res, 400, 'invalid json body');
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return sendError(res, 400, 'invalid json body');
  }

  const msgErr = validateMessages(value.messages);
  if (msgErr) return sendError(res, 400, msgErr);

  const model = value.model === undefined ? config.LLM_MODEL : String(value.model);
  if (!config.LLM_ALLOWED_MODELS.includes(model)) {
    return sendError(res, 400, 'model not allowed');
  }

  if (!config.ZHIPU_API_KEY) {
    return sendError(res, 500, 'ZHIPU_API_KEY not configured');
  }

  const temperature =
    typeof value.temperature === 'number' && Number.isFinite(value.temperature)
      ? Math.min(Math.max(value.temperature, 0), 1)
      : 0.4;
  const maxTokens =
    typeof value.max_tokens === 'number' && Number.isFinite(value.max_tokens)
      ? Math.min(Math.max(Math.floor(value.max_tokens), 1), config.LLM_MAX_TOKENS)
      : Math.min(800, config.LLM_MAX_TOKENS);

  const payload = {
    model,
    messages: value.messages,
    temperature,
    max_tokens: maxTokens,
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
        (parsed && parsed.error && (parsed.error.message || parsed.error)) || text || 'upstream error';
      return sendError(res, upstream.status, `llm upstream error: ${String(msg).slice(0, 200)}`);
    }
    return sendJson(res, 200, parsed !== null ? parsed : { raw: text });
  } catch (err) {
    return sendError(res, 502, `llm upstream unavailable: ${String(err.message).slice(0, 200)}`);
  }
});

module.exports = router;
