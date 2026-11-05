'use strict';
/* /api/* —— 健身器械助手业务接口
   严格对齐 docs/api.md（V2）与旧模拟后端 serve.py 的行为，前端零改动：
   | 集合 | GET | POST | PUT | DELETE |
   |---|---|---|---|---|
   | coaches/equipments/users | 列表/单条 | 新增(8位id, coaches/equipments 缺 name→400) | 按 id 合并更新 | 按 id 删除 |
   | profile/plans | 列表 | 405 | 全量替换(JSON 数组) | 405 |
   | logs/lessons | 列表(可过滤) | 按 date upsert | 按 id(无 id→404) | 按 id(无 id→404) |
   | bootstrap | 一次聚合 {coaches,equipments,profile} | — | — | — | */

const express = require('express');
const repo = require('../repo');
const auth = require('../auth');
const { sendJson, sendError, parseJsonBody } = require('../http');

const router = express.Router();

/* 查询过滤：?date= 精确匹配日期；?coach= 精确匹配 coachName（可叠加）
   —— 参数「存在」即生效（与旧实现 query 字典语义一致） */
function filterByQuery(items, query) {
  const hasDate = Object.prototype.hasOwnProperty.call(query || {}, 'date');
  const hasCoach = Object.prototype.hasOwnProperty.call(query || {}, 'coach');
  if (!hasDate && !hasCoach) return items;
  return items.filter((it) => {
    if (hasDate && it.date !== query.date) return false;
    if (hasCoach && it.coachName !== query.coach) return false;
    return true;
  });
}

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/* ---------------------------------------------------------------- 读接口 */

/** 启动聚合：用户端首屏一次拉全 */
router.get('/bootstrap', (req, res) => {
  repo.prepareRead('equipments');
  sendJson(res, 200, {
    coaches: repo.list('coaches'),
    equipments: repo.list('equipments'),
    profile: repo.list('profile'),
  });
});

/** 集合列表 */
router.get('/:coll', (req, res) => {
  const coll = req.params.coll;
  if (!repo.isCollection(coll)) return sendError(res, 404, 'unknown collection');
  repo.prepareRead(coll);
  const items = repo.list(coll);
  if (coll === 'logs' || coll === 'lessons') {
    return sendJson(res, 200, filterByQuery(items, req.query));
  }
  return sendJson(res, 200, items);
});

/** 集合单条（按 id） */
router.get('/:coll/:id', (req, res) => {
  const coll = req.params.coll;
  if (!repo.isCollection(coll)) return sendError(res, 404, 'unknown collection');
  repo.prepareRead(coll);
  // 旧实现中 logs/lessons 的「查询过滤」分支先于「单条」分支命中 → 返回过滤后的数组
  if (coll === 'logs' || coll === 'lessons') {
    return sendJson(res, 200, filterByQuery(repo.list(coll), req.query));
  }
  const hit = repo.findById(coll, req.params.id);
  if (!hit) return sendError(res, 404, 'not found');
  return sendJson(res, 200, hit);
});

/* -------------------------------------------------------------- 写接口 */

/** 新增 / 上报 */
router.post('/:coll', (req, res) => {
  const coll = req.params.coll;
  if (!repo.isCollection(coll)) return sendError(res, 404, 'unknown collection');
  // 管理端集合的写操作需 Token（logs/lessons 为用户端上报，保持开放）
  if (repo.ADMIN_MANAGED.includes(coll) && !auth.check(req)) {
    return sendError(res, 401, 'unauthorized');
  }
  const { ok, value } = parseJsonBody(req);
  if (!ok || value === null) return sendError(res, 400, 'invalid json body');
  // profile/plans 仅接受 PUT + JSON 数组
  if (repo.FULL_REPLACE_ONLY.includes(coll)) {
    return sendError(res, 405, `${coll} supports PUT list only`);
  }
  if (!isPlainObject(value)) return sendError(res, 400, 'invalid json body');
  // coaches/equipments：name 必填
  if ((coll === 'coaches' || coll === 'equipments') && !value.name) {
    return sendError(res, 400, 'name required');
  }
  // logs/lessons：按 date upsert —— 同日已存在则整体覆盖整条记录（防重复追加）
  if (repo.DATE_UPSERT.includes(coll) && typeof value.date === 'string' && value.date !== '') {
    const key = `date:${value.date}`;
    if (repo.findByKey(coll, key)) {
      repo.updateByKey(coll, key, value);
    } else {
      repo.insert(coll, value);
    }
    return sendJson(res, 200, { ok: true, id: value.id === undefined ? null : value.id });
  }
  // 普通新增：id 服务端生成（8 位十六进制）；body 已带 id 则沿用（契约 §1）
  const record = { ...value };
  if (record.id === undefined || record.id === null || record.id === '') {
    record.id = repo.newId();
  }
  repo.insert(coll, record);
  return sendJson(res, 200, { ok: true, id: record.id });
});

/** 更新（按 id 合并更新；profile/plans 全量替换） */
function handlePut(req, res, id) {
  const coll = req.params.coll;
  if (!repo.isCollection(coll)) return sendError(res, 404, 'unknown collection');
  if (repo.ADMIN_MANAGED.includes(coll) && !auth.check(req)) {
    return sendError(res, 401, 'unauthorized');
  }
  const { ok, value } = parseJsonBody(req);
  if (!ok || value === null) return sendError(res, 400, 'invalid json body');
  // profile/plans：PUT + JSON 数组 = 全量替换（其余方法 405）
  if (repo.FULL_REPLACE_ONLY.includes(coll)) {
    if (!Array.isArray(value)) return sendError(res, 405, `${coll} supports PUT list only`);
    const count = repo.replaceAll(coll, value);
    return sendJson(res, 200, { ok: true, count });
  }
  if (!id) return sendError(res, 405, 'item id required');
  if (!isPlainObject(value)) return sendError(res, 400, 'invalid json body');
  const hit = repo.findEntryById(coll, id);
  if (!hit) return sendError(res, 404, 'not found');
  const merged = { ...hit.record };
  delete value.id; // PUT 忽略 body 中的 id
  Object.assign(merged, value);
  repo.updateByKey(coll, hit.key, merged);
  return sendJson(res, 200, { ok: true });
}

router.put('/:coll', (req, res) => handlePut(req, res, null));
router.put('/:coll/:id', (req, res) => handlePut(req, res, req.params.id));

/** 删除（按 id） */
function handleDelete(req, res, id) {
  const coll = req.params.coll;
  if (!repo.isCollection(coll)) return sendError(res, 404, 'unknown collection');
  if (repo.ADMIN_MANAGED.includes(coll) && !auth.check(req)) {
    return sendError(res, 401, 'unauthorized');
  }
  // profile/plans 仅支持 PUT 全量替换
  if (repo.FULL_REPLACE_ONLY.includes(coll)) {
    return sendError(res, 405, `${coll} supports PUT list only`);
  }
  if (!id) return sendError(res, 405, 'item id required');
  const hit = repo.findEntryById(coll, id);
  if (!hit) return sendError(res, 404, 'not found');
  repo.removeByKey(coll, hit.key);
  return sendJson(res, 200, { ok: true });
}

router.delete('/:coll', (req, res) => handleDelete(req, res, null));
router.delete('/:coll/:id', (req, res) => handleDelete(req, res, req.params.id));

/* 其余方法（PATCH/OPTIONS 等）→ 405 */
router.use((req, res) => sendError(res, 405, 'method not allowed'));

module.exports = router;
