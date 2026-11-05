'use strict';
/* 管理端 Token 鉴权
   - 环境变量 ADMIN_TOKEN 为空 → 不开启鉴权（本地开发零配置）
   - 开启后：管理端集合（coaches/equipments/users/profile/plans）的写操作必须携带
     请求头 X-Admin-Token（或同名 Cookie），否则 401
   - 读接口一律开放（用户端无需登录）
   - logs/lessons 为用户端上报接口，保持开放，不做鉴权 */

const crypto = require('crypto');
const config = require('./config');

const COOKIE_NAME = 'gym_admin_token';

/** 定时安全比较，避免按字节比较带来的时序侧信道 */
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/** 从请求中取出候选 Token：请求头优先，其次 Cookie */
function extractToken(req) {
  const header = req.get('X-Admin-Token');
  if (header) return header.trim();
  const cookies = req.cookies || {};
  if (cookies[COOKIE_NAME]) return String(cookies[COOKIE_NAME]).trim();
  // 兜底：query 参数（便于 curl / 脚本直接调用）
  if (req.query && req.query.admin_token) return String(req.query.admin_token).trim();
  return '';
}

/** 鉴权是否开启 */
const enabled = () => !!config.ADMIN_TOKEN;

/**
 * 校验请求是否携带有效 Token（供路由内联调用）
 * @returns {boolean} true=放行
 */
function check(req) {
  if (!enabled()) return true; // 未配置 Token → 放行（开发模式）
  const token = extractToken(req);
  return !!token && safeEqual(token, config.ADMIN_TOKEN);
}

/**
 * 写操作鉴权中间件：仅在 ADMIN_TOKEN 已配置时生效
 */
function requireAdmin(req, res, next) {
  if (!enabled()) return next(); // 未配置 Token → 放行（开发模式）
  if (check(req)) return next();
  return res.status(401).json({ error: 'unauthorized' });
}

/** 校验单个 Token（供 /api/llm 等按需鉴权使用） */
function isValid(token) {
  if (!enabled()) return true;
  return !!token && safeEqual(token, config.ADMIN_TOKEN);
}

module.exports = { requireAdmin, check, enabled, isValid, extractToken, COOKIE_NAME };
