'use strict';
/* HTTP 工具：统一 JSON 解析（对齐旧实现语义）与响应输出
   契约：错误格式统一 {"error": "<原因>"}；JSON 编码 UTF-8；所有响应 no-cache */

const express = require('express');
const config = require('./config');

/** 统一响应头：禁用缓存 + UTF-8 JSON */
function applyCommonHeaders(res) {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
}

/** 发送 JSON 响应 */
function sendJson(res, status, payload) {
  applyCommonHeaders(res);
  res.status(status);
  res.set('Content-Type', 'application/json; charset=utf-8');
  res.send(JSON.stringify(payload));
}

/** 发送错误响应（契约统一错误格式） */
function sendError(res, status, message) {
  sendJson(res, status, { error: String(message) });
}

/**
 * 解析请求体 JSON —— 与旧实现语义一致：
 *   - 无 body         → null（POST/PUT 视为非法 JSON → 400）
 *   - body 为 "null"  → null
 *   - JSON 解析失败   → null（POST/PUT → 400）
 *   - 其余            → 解析结果（对象/数组/数字/字符串均可）
 */
function parseJsonBody(req) {
  const raw = req.body;
  if (raw == null) return { ok: true, value: null };
  const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
  if (!text.trim()) return { ok: true, value: null };
  try {
    const value = JSON.parse(text);
    return { ok: true, value: value === undefined ? null : value };
  } catch (e) {
    return { ok: false, value: null };
  }
}

/** 原始 body 缓冲中间件：自行解析以精确控制 400 语义（不因 Content-Type 缺失而漏解析） */
function rawBody() {
  return express.raw({ type: () => true, limit: config.JSON_LIMIT });
}

module.exports = { applyCommonHeaders, sendJson, sendError, parseJsonBody, rawBody };
