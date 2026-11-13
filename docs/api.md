# 健身器械助手 · 接口契约文档

> 后端：`server/`（Node + Express + SQLite 生产级后端，`node server/src/index.js` 启动）。实现与本文档一致，前端无需改动。
> 版本：V2.1（2026-11-09）· 新增 `mappings` 集合（动作→肌群映射）、`equipments.guide` 字段；V2（2026-11-03）对应 `feat/ui-redesign-v2`

## 1. 总览

| 项 | 约定 |
|---|---|
| Base URL | `http://127.0.0.1:<port>`（启动：`node server/src/index.js`，默认端口 8080，可用 `PORT` 环境变量覆盖） |
| 数据格式 | 请求/响应均为 UTF-8 JSON（代理接口透传上游格式） |
| 鉴权 | 默认无（本地开发）；设置 `ADMIN_TOKEN` 后管理端集合写操作需 `X-Admin-Token` 头/同名 Cookie |
| 缓存 | 所有响应带 `Cache-Control: no-cache, no-store, must-revalidate` |
| 存储 | SQLite（`server/data/gym.db`，items 表按集合分键），WAL 日志模式 |
| 初始化 | 首次启动：存量 `data/*.json` 自动导入（存在时）→ 空集合用内置默认值播种 |
| 错误格式 | `{"error": "<原因>"}`，配 4xx 状态码 |

### 集合一览

| 集合 | 用途 | GET | POST | PUT | DELETE |
|---|---|---|---|---|---|
| coaches | 教练管理 | 列表/单条 | 新增 | 按 id 更新 | 按 id 删除 |
| equipments | 器械库+教程+发力肌群+使用要点 | 列表/单条 | 新增 | 按 id 更新 | 按 id 删除 |
| users | 用户档案（后台管理视图） | 列表/单条 | 新增 | 按 id 更新 | 按 id 删除 |
| profile | 用户端「我的」页档案卡 | 列表 | — | **全量替换** | — |
| plans | 训练方案配置（5 部位） | 列表 | — | **全量替换** | — |
| logs | 训练日志（用户端上报） | 列表（可过滤） | **按 date upsert** | — | — |
| lessons | 教练课预约（用户端上报） | 列表（可过滤） | **按 date upsert** | — | — |
| mappings | 动作→肌群映射规则 | 列表/单条 | 新增 | 按 id 更新 | 按 id 删除 |
| bootstrap | 启动聚合包 | 一次拉全 | — | — | — |

通用规则：
- 新增时后端自动生成 id：8 位十六进制（body 已带 id 则沿用）
- PUT 需 URL 带 id（`/api/coaches/c1`），body 中 `id` 字段被忽略，其余字段**合并更新**
- `coaches`/`equipments` POST 时 `name` 必填；`mappings` POST 时 `keyword` + `muscle` 必填，否则 400
- `profile`/`plans` 仅接受 `PUT` + JSON 数组 body（全量替换），其他方法返回 405

---

## 2. 数据模型与接口明细

### 2.1 coaches（教练）

```json
{ "id": "c1", "name": "田文镜", "course": "力量训练课", "tags": ["ACSM", "力量训练"] }
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| id | string | 自动 | |
| name | string | ✔ | 姓名（预约页/首页引导卡展示） |
| course | string | — | 主授课程 |
| tags | string[] | — | 资质标签（蓝胶囊展示） |

### 2.2 equipments（器械）

```json
{
  "id": "lat_pull", "type": "背部", "name": "坐姿高位下拉器械",
  "videoUrl": "https://…mp4", "videoJump": "https://xhslink.cn/…", "safety": "加片之前先加控制…",
  "muscles": ["背阔肌", "菱形肌", "斜方肌中下束"],
  "subMuscles": ["肱二头肌", "前臂"]
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | 器械标识（百度识别匹配键、方案教学跳转键） |
| type | string | 部位分组：胸部/背部/腿部/臀部/肩部/手臂/多功能 |
| videoUrl | string | 教程视频地址（详情页内播） |
| videoJump | string | 小红书外链（「去小红书看」跳转） |
| safety | string | 安全提示（详情页红调警示卡） |
| guide | string | **使用要点**（详情页「使用要点」卡；留空不渲染该块） |
| muscles | string[] | **主发力肌群**（中文名，详情页人体模型标红） |
| subMuscles | string[] | **辅助发力肌群**（标橙；与 muscles 同名时自动去重） |

> 加载兜底：读取时若记录缺 `muscles`/`subMuscles`，按内置默认表补全并写回（幂等，无需手工迁移）。
> 肌群中文名由前端别名表匹配模型区块，支持口语化写法（如「斜方肌中下束」「肩袖肌群」）。

### 2.3 users（用户列表 · 后台）

```json
{
  "id": "u1", "nickname": "曹操", "phone": "13812345678",
  "visitAt": "2026-10-25 09:30", "coach": "田文镜",
  "heart": 72, "heartAt": "2026-10-11 10:02",
  "weight": 68.5, "fatRate": 18.2, "bodyAt": "2026-10-08 19:40",
  "contract": "有效期至 2027-10-11", "leave": "剩余 12 天"
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| phone | string | 列表页脱敏展示（前 3 + `****` + 后 4） |
| heart / heartAt | number / string | 心率值与记录时间（时间由保存端生成） |
| weight / fatRate / bodyAt | number / number / string | 体重 kg、体脂率 %（一位小数展示）、记录时间 |
| contract / leave | string | 合同/请假记录，仅展示不可编辑 |

### 2.4 profile（用户端档案卡）

```json
[
  { "title": "心率记录", "main": "最近一次 72 次/分", "sub": "记录日期 2026-10-11" },
  { "title": "体测记录", "main": "体重 68.5 kg ／ 体脂 18.2%", "sub": "体测日期 2026-10-08" },
  { "title": "合同记录", "main": "有效期至 2027-10-11", "sub": "" },
  { "title": "请假记录", "main": "剩余 12 天", "sub": "" }
]
```

`GET /api/profile` 返回数组；`PUT /api/profile` **全量替换**（body 必须为数组）。

### 2.5 plans（训练方案配置）

数组每项对应一个部位。用户端「生成今日方案」**优先使用本配置**，未配置的部位回退前端内置模板。

```json
{
  "id": "back", "part": "背",
  "warmup": {
    "targets": "背阔肌、菱形肌、斜方肌中下束、三角肌后束、肩袖肌群",
    "method": "动态拉伸 + 轻重量器械试做",
    "standard": "背部微微发热、心率略升，手臂不发酸。"
  },
  "steps": [
    {
      "stage": "宽度构建", "action": "高位下拉（宽握）",
      "equipId": "lat_pull", "equipText": "高位下拉机",
      "sets": 4, "reps": 12, "repsTxt": "4组 × 12次", "w": 40,
      "focus": "背阔肌外侧",
      "knee": "膝盖友好点（可选，腿部方案用）",
      "detail": "身体微后仰15度，挺胸，手肘往腰间带；还原慢放3秒。",
      "rest": "90秒"
    }
  ],
  "stretch": [
    { "action": "双手抓龙门架柱，身体下压", "target": "拉伸背阔肌", "time": "每侧30秒" }
  ]
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| id | string | 部位键：back/chest/leg/shoulder/arm（前端按此匹配） |
| part | string | 部位名（用户端选部位瓦片对应） |
| warmup.targets / method / standard | string | 热身三要素（项目符号渲染） |
| steps[].stage | string | 阶段名（蓝色标签，同阶段多动作共用） |
| steps[].action | string | 动作名 |
| steps[].equipId | string | 教学跳转器械 id；**空串=不渲染「教学」按钮**（徒手动作） |
| steps[].equipText | string | 器械展示文案 |
| steps[].sets / reps | number | 组数/次数（**录入弹层预填组数**） |
| steps[].repsTxt | string | 组次展示文本（支持「3组 × 12次/侧」「4组 × 10-12次」） |
| steps[].w | number | 参考重量 kg（`0=自重`，完成态显示「自重」） |
| steps[].focus | string | 目标肌群 |
| steps[].knee | string | 膝盖友好点（可选字段，缺失不渲染该行） |
| steps[].detail | string | 关键细节（段落） |
| steps[].rest | string | 组间休息 |
| stretch[].action / target / time | string | 拉伸收尾项 |

`PUT /api/plans` **全量替换**（后台「保存方案配置」一次提交全部部位）。

### 2.6 logs（训练日志 · 用户端上报）

```json
{
  "date": "2026-11-03",
  "type": "自由训练",
  "solo": [ { "action": "高位下拉", "sets": 4, "weight": 40 } ],
  "coach": { "name": "田文镜", "course": "力量训练课" },
  "updatedAt": "2026-11-03 19:22:31"
}
```

- `POST /api/logs`：**按 `date` upsert**——同日已存在则整体覆盖，防止重复追加
- `GET /api/logs`：全量；`GET /api/logs?date=2026-11-03`：按日过滤

### 2.7 lessons（教练课预约 · 用户端上报）

```json
{
  "date": "2026-11-03",
  "coachName": "田文镜",
  "course": "力量训练课",
  "submittedAt": "2026-11-03 19:30:05"
}
```

- `POST /api/lessons`：按 `date` upsert（同日重复提交覆盖）
- `GET /api/lessons`：全量；支持 `?date=`（按日）与 `?coach=`（按 `coachName` 精确匹配，可叠加）

### 2.8 mappings（动作→肌群映射规则）

首页「最近运动」摘要卡（恢复/频率建议）按**动作名包含关键词**判定肌群；记录顺序即优先级，首个命中的关键词生效。全部未命中回退前端内置规则，再回退「全身」。

```json
{ "id": "map07", "keyword": "下拉", "muscle": "背" }
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| id | string | 自动 | |
| keyword | string | ✔ | 动作名关键词（`includes` 子串匹配） |
| muscle | string | ✔ | 肌群：胸/背/腿/肩/手臂/全身 |

- 标准 CRUD 集合（POST/PUT/DELETE 需管理 Token）；`POST` 缺 `keyword`/`muscle` → 400
- 调整优先级 = 交换相邻记录的 keyword/muscle（前端「上移」按钮封装此操作）
- 首次启动播种 19 条默认规则（与前端 `js/summary.js` 内置兜底语义一致）
- 用户端经 `bootstrap.mappings` 拉取；拉取失败回退 `js/summary.js` 内置规则

### 2.9 bootstrap（启动聚合）

`GET /api/bootstrap` → `{ "coaches": [...], "equipments": [...], "profile": [...], "mappings": [...] }`
用户端首屏一次拉全，失败自动回退前端内置默认值（兼容 GitHub Pages 纯静态部署）。

---

## 3. 代理接口（Key 不落前端日志）

| 路由 | 上游 | 说明 |
|---|---|---|
| `ANY /proxy/*` | `https://aip.baidubce.com/*` | 百度识图（access_token 由前端向百度换取，经此转发） |
| `ANY /proxy/llm` | `open.bigmodel.cn /api/paas/v4/chat/completions` | 智谱 LLM（最近运动摘要文案改写；`Authorization` 头透传） |

行为：方法/Body/`Content-Type`/`Authorization` 原样透传；上游错误原样返回状态码；网络异常 502 `text/plain`。服务端日志不打印 query（避免 Key 泄露）。

---

## 4. 状态码汇总

| 码 | 场景 |
|---|---|
| 200 | 成功 |
| 400 | body 非 JSON / POST 缺 `name` / `messages` 不合法 / `model` 不在白名单 |
| 401 | 开启 `LLM_REQUIRE_ADMIN=1` 时 `/api/llm/summary` 缺少或错误的管理端 Token |
| 403 | 非本机回环访问静态目录下的 `*.local.js`（私有配置不下发外网） |
| 404 | 未知集合 / id 不存在 / 静态 404 |
| 405 | profile、plans 用了非 PUT；PUT/DELETE 缺 id |
| 429 | `/api/llm/summary` 触发频控（默认每 IP 10 次/分钟，响应带 `Retry-After: 60`） |
| 502 | 代理上游网络异常 |

## 5. 真后端对接清单（迁移时需实现）

1. 上表 8 组路由 + 语义（尤其：logs/lessons 按 date upsert、profile/plans 仅 PUT 全量、equipments 缺字段补全）
2. 响应结构与字段名与本文档完全一致（前端零改动）
3. 鉴权与多用户隔离（当前单用户本地形态）
4. AI Key 下沉服务端（前端 `config.local.js` 只允许放百度识别 Key，**禁止**出现智谱/LLM Key）
