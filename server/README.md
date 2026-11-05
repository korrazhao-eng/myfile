# 健身器械助手 · 生产级后端

Node.js + Express + SQLite（better-sqlite3）实现的正式后端，**完全兼容 `gym-app/docs/api.md`（V2）接口契约**，
替换原单文件模拟后端 `serve.py`（Python 标准库 + `data/*.json` 文件存储）。

前端（用户端 `index.html` + 管理后台 `admin.html`）**零改动**即可运行：除 `js/summary.js` 中 AI 调用点
由 `/proxy/llm` 改为 `/api/llm/summary`（Key 下沉服务端）外，未改动任何页面结构 / 样式 / 交互。

---

## 1. 快速开始

```bash
cd gym-app/server
npm install          # 安装 express + better-sqlite3（首次）
npm run migrate      # 一次性把 gym-app/data/*.json 导入 SQLite（幂等）
npm start            # 启动，默认 http://0.0.0.0:8080
```

启动后：

| 地址 | 说明 |
|---|---|
| `http://127.0.0.1:8080/` | 用户端（`index.html`） |
| `http://127.0.0.1:8080/admin.html` | 管理后台（教练 / 器械 / 用户数据 / 课程记录 / 方案配置） |
| `http://127.0.0.1:8080/api/bootstrap` | 启动聚合接口 |

> `npm run migrate` 可省略：首次启动时若数据库为空，后端会自动导入 `gym-app/data/*.json`（仅一次，之后不再重复导入）。

一键验证：

```bash
npm run smoke       # 冒烟测试：自动起隔离实例，覆盖 200/400/401/404/405/502 + 各集合增删改查
```

---

## 2. 环境变量

全部可选，不设置也能 `npm start` 跑起来（零配置默认即生产可用形态）。

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `8080` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址；设 `127.0.0.1` 则仅本机可访问 |
| `ADMIN_TOKEN` | 空 | 管理端写操作 Token；**为空 = 不开启鉴权**（本地开发） |
| `ZHIPU_API_KEY` | 空 | 智谱大模型 Key（**只在服务端持有**，不下发前端） |
| `ZHIPU_BASE_URL` | `https://open.bigmodel.cn/api/paas/v4` | 智谱 OpenAI 兼容接口基址 |
| `LLM_MODEL` | `glm-4-flash` | `/api/llm/summary` 默认模型 |
| `BAIDU_UPSTREAM` | `https://aip.baidubce.com` | `/proxy/*` 透传上游（百度智能云） |
| `DB_PATH` | `server/data/gym.db` | SQLite 数据库文件 |
| `DB_DRIVER` | `auto` | SQLite 驱动：`auto`（默认，优先 better-sqlite3）/ `better-sqlite3`（强制）/ `node:sqlite`（强制用 Node 内置） |
| `DB_JOURNAL_MODE` | 空 | 日志模式：空 = 自动（WAL → TRUNCATE → MEMORY 依次自检可用性） |
| `STATIC_ROOT` | `gym-app/` | 静态托管根目录（与 `serve.py` 行为一致） |
| `LEGACY_DATA_DIR` | `gym-app/data` | 存量 JSON 数据目录（迁移脚本读取） |
| `JSON_LIMIT` | `10mb` | 请求体大小上限 |
| `LLM_TIMEOUT` / `PROXY_TIMEOUT` | `30000` | 上游请求超时（毫秒） |

示例（生产形态）：

```bash
ADMIN_TOKEN='s3cret-token' ZHIPU_API_KEY='your-zhipu-key' PORT=8080 npm start
```

---

## 3. 鉴权（新增能力）

- **读接口全部开放**（用户端无需登录）：`GET /api/*` 任何集合均可匿名读取。
- **管理端写操作需 Token**：当 `ADMIN_TOKEN` 非空时，`POST/PUT/DELETE`
  `/api/coaches|equipments|users|profile|plans` 必须携带 `X-Admin-Token` 请求头，否则返回 **401** `{"error":"unauthorized"}`。
- **用户端上报接口保持开放**：`POST /api/logs`、`POST /api/lessons` 是用户行为上报（本地训练记录同步），不参与鉴权，
  以保证「用户端完成一次训练 → 后台训练日志出现记录」链路在开启鉴权后依然可用。
- Token 校验采用定时安全比较（`crypto.timingSafeEqual`），防时序侧信道。

### 管理后台如何通过鉴权（前端零改动）

打开 `/admin.html` 时，后端会下发一个 `HttpOnly` Cookie（`gym_admin_token`），
浏览器随同源请求自动带上，后台页面的增删改因此无需任何前端改动即可通过校验。
同时支持脚本直接调用：

```bash
curl -H "X-Admin-Token: $ADMIN_TOKEN" -X POST http://127.0.0.1:8080/api/coaches \
  -H 'Content-Type: application/json' -d '{"name":"新教练","course":"力量训练课","tags":["ACSM"]}'
```

> ⚠️ 安全边界：本方案是「简单 Token」，不含账号体系与多用户隔离。
> 管理后台页面对能访问该端口的人都是开放的，建议部署时用反向代理 / 内网 / IP 白名单把 `/admin.html` 与
> `/api/*` 的写操作限制在可信网络内；`ADMIN_TOKEN` 主要用于保护 API 被外部脚本直接调用。

---

## 4. 数据迁移

### 一次性迁移脚本

```bash
cd gym-app/server
npm run migrate                                   # 导入 gym-app/data/*.json → server/data/gym.db
npm run migrate -- --db /path/to/other.db        # 指定数据库文件
npm run migrate -- --data /path/to/legacy/json   # 指定存量 JSON 目录
```

- **幂等**：按「集合整体替换」导入，重复执行结果一致（记录数 28 → 28）。
- 迁移后自动执行器械发力肌群兜底补全（见 §6 规则 3）。
- 注意：导入会覆盖同名集合在库中的内容。如需保留运行期新增记录，请勿重复执行迁移。

### 首次启动自动导入

数据库为空且存在 `gym-app/data/*.json` 时，`npm start` 会自动完成一次导入并打印摘要；
若既无存量数据也无数据库，则用内置默认数据播种各集合（与旧 `serve.py` 的 `DEFAULTS` 完全一致）。

### 数据库结构

单表 `items` 存全部集合，字段名 / 类型 / 顺序与旧 JSON 文件完全一致，GET 直接回吐原对象：

```sql
CREATE TABLE items (
  collection  TEXT    NOT NULL,   -- 集合名
  item_key   TEXT    NOT NULL,   -- 记录唯一键（见下）
  ord        INTEGER NOT NULL,   -- 数组顺序
  data       TEXT    NOT NULL,   -- 整条记录的 JSON
  updated_at TEXT    NOT NULL,
  PRIMARY KEY (collection, item_key)
);
```

`item_key` 规则（运行时与迁移脚本共用，保证幂等）：

| 集合 | 键 |
|---|---|
| `coaches` / `equipments` / `users` | `id:<记录 id>` |
| `logs` / `lessons`（有 `date`） | `date:<日期>` ← 即「按 date upsert」的落库键 |
| `logs` / `lessons`（无 `date`） | `id:<记录 id>` |
| `plans` | `id:<方案 id>`（无 id 时 `idx:<下标>`） |
| `profile` | `idx:<下标>` |

---

## 5. 接口一览（与 `docs/api.md` 一致）

| 路由 | 说明 |
|---|---|
| `GET /api/bootstrap` | `{ coaches, equipments, profile }` 一次聚合 |
| `GET /api/:coll` | 集合列表；`logs`/`lessons` 支持 `?date=` `?coach=`（可叠加） |
| `GET /api/:coll/:id` | 单条（按 id）；`logs`/`lessons` 返回过滤后的数组 |
| `POST /api/:coll` | 新增（生成 8 位 id）/ 上报（按 date upsert） |
| `PUT /api/:coll/:id` | 按 id 合并更新（忽略 body 中的 `id`） |
| `PUT /api/profile`、`PUT /api/plans` | 全量替换（body 必须是 JSON 数组） |
| `DELETE /api/:coll/:id` | 按 id 删除 |
| `POST /api/llm/summary` | 智谱大模型代理（服务端持 Key） |
| `GET /api/llm/status` | 返回 Key 是否已配置（运维排查用） |
| `ANY /proxy/*` | 百度智能云透传（前端 `baidu-ai.js` 零改动） |

统一约定：响应头 `Cache-Control: no-cache, no-store, must-revalidate`；JSON 响应 `charset=utf-8`；
错误体统一 `{"error": "<原因>"}`。

### 状态码

| 码 | 场景 |
|---|---|
| 200 | 成功 |
| 400 | body 非 JSON / POST 缺 `name` / LLM 缺 `messages` |
| 401 | 管理端写操作 Token 校验失败 |
| 404 | 未知集合 / id 不存在 / 静态 404 |
| 405 | `profile`/`plans` 用了非 PUT；PUT/DELETE 缺 id；集合不支持该方法 |
| 502 | 上游（百度 / 智谱）网络异常 |

---

## 6. 业务规则（易错点，逐条对齐契约）

1. **logs / lessons 的 POST 按 `date` upsert**：同 `date` 已存在则**整体覆盖整条记录**（不是追加）。
   无 `date` 时退化为普通追加（自动生成 id），与旧实现一致。
2. **profile / plans 只接受 `PUT` + JSON 数组**（全量替换）；`POST`/`DELETE` 返回 405，`PUT` 传非数组也返回 405。
3. **equipments 读取时缺 `muscles`/`subMuscles` 字段** → 按内置默认表补全并写回（幂等，无需手工迁移）。
   只判断「字段是否存在」，空数组视为已配置、不覆盖。
4. **coaches / equipments 的 POST 缺 `name` 返回 400**（`users` 无此限制）。
5. **POST 新增记录 id 服务端生成（8 位十六进制）**；body 已带 `id` 则沿用（契约 §1）。
   `PUT` **忽略 body 中的 `id`**，其余字段合并更新。
6. **查询参数**：`lessons` 支持 `?date=` 与 `?coach=`（匹配 `coachName`，可叠加）；`logs` 支持 `?date=`。
   参数「存在」即生效（`?date=` 空值同样参与过滤）。
7. **bootstrap 一次聚合**返回 `{coaches, equipments, profile}`。

---

## 7. AI 代理（Key 下沉服务端）

```bash
curl -X POST http://127.0.0.1:8080/api/llm/summary \
  -H 'Content-Type: application/json' \
  -d '{"model":"glm-4-flash","messages":[{"role":"user","content":"写一句训练建议"}]}'
```

- 服务端用 `ZHIPU_API_KEY` 组装 `Authorization: Bearer <key>`，转发到
  `https://open.bigmodel.cn/api/paas/v4/chat/completions`，响应原样回传前端。
- 上游错误 → 原样返回上游状态码（错误体统一为 `{"error": "..."}`）；网络异常 → 502；未配置 Key → 500。
- 前端 `js/summary.js` 的调用点已改为 `/api/llm/summary` 并**移除前端 Key**；
  服务端未配置 Key 时前端静默降级到本地模板文案（不弹提示，与原行为一致）。

---

## 8. 目录结构

```
gym-app/server/
├── package.json
├── README.md
├── smoke.sh                     # 冒烟测试（隔离实例，不污染开发库）
├── scripts/
│   ├── migrate.js               # 存量 JSON → SQLite（一次性、幂等）
│   ├── probe-driver.js          # better-sqlite3 原生绑定自检（子进程隔离）
│   ├── probe-db.js              # 库文件 + 日志模式可写性自检（子进程隔离）
│   └── stub-upstream.js         # 冒烟测试用的上游桩（验证代理透传/502）
├── src/
│   ├── index.js                 # 入口：初始化数据 → 启动服务
│   ├── app.js                   # Express 装配（路由顺序 / 静态托管 / 404 / 错误处理）
│   ├── config.js                # 环境变量
│   ├── db.js                    # SQLite 连接、日志模式协商、安全关闭
│   ├── sqlite-driver.js         # 驱动选择（better-sqlite3 → node:sqlite 回退）+ API 适配
│   ├── repo.js                  # 集合仓储层（upsert / 全量替换 / 补全 / id 生成）
│   ├── importer.js              # 存量数据导入（脚本与启动共用）
│   ├── auth.js                  # X-Admin-Token 鉴权
│   ├── http.js                  # JSON 解析与统一响应
│   ├── defaults.js              # 内置默认数据（由 serve.py DEFAULTS 导出生成）
│   └── routes/
│       ├── api.js               # /api/*
│       ├── llm.js               # /api/llm/*
│       └── proxy.js             # /proxy/*
└── data/gym.db                  # SQLite 数据文件（自动创建，已 gitignore）
```

---

## 9. 存储层韧性（为什么换台机器也能起）

原生 SQLite 扩展 + 各种受限文件系统是「本地能跑、换个环境就崩」的高发区。后端为此做了三层兜底，
**不需要任何额外配置**：

| 故障场景 | 表现 | 处理方式 |
|---|---|---|
| `better-sqlite3` 原生绑定与当前 Node ABI 不匹配 / 未编译 / 被环境拦截 | `ERR_DLOPEN_FAILED` 或进程被强杀 | 启动时用**子进程**做真实读写自检；不可用则自动回退到 Node 内置 `node:sqlite`（Node ≥ 22.5，无需编译），业务层 API 完全一致 |
| WAL 模式在当前文件系统不可用（无法创建 `-shm`、删除被拦截） | `disk I/O error` | 启动时依次自检 `WAL → TRUNCATE → MEMORY`，采用第一个真正写成功的模式 |
| 库文件本身与当前环境不兼容（如遗留的 WAL 库） | 打开即报错 | 自动在同目录重建 `*.rebuilt` 并**搬迁全部记录**，服务照常启动（会打印醒目提示） |

配套的细节：

- **自检全部在子进程里做**：坏掉的原生绑定可能让主进程直接被 `SIGKILL`（无法 `try/catch`），
  隔离后主进程只会看到「子进程异常退出」，从而安全切换路径。
- **优雅关闭**：`SIGINT`/`SIGTERM` → 先 `wal_checkpoint(TRUNCATE)` 把 WAL 落盘；
  若当前文件系统不允许删除文件（WAL 下 `close()` 会删 `-wal/-shm`），则跳过 `close()`，
  残留文件由 SQLite 在下次启动时自动恢复 —— 任何情况下都能干净退出、释放端口，不丢数据。
- **自检结果带缓存**：`<DB_PATH> 同目录>/.driver-probe.json` 记录自检结论（按
  better-sqlite3 版本 + Node ABI + 二进制指纹失效），避免每次启动都多起进程。
- 强制指定：`DB_DRIVER=better-sqlite3` / `DB_DRIVER=node:sqlite`；`DB_JOURNAL_MODE=wal|truncate|memory`。

> 采用 `node:sqlite` 回退时，Node 22 会打印一行 `ExperimentalWarning`，属正常提示，不影响功能。

---

## 10. 与旧 `serve.py` 的差异

| 维度 | 旧 `serve.py` | 新后端 |
|---|---|---|
| 技术栈 | Python 标准库 | Node.js + Express + SQLite（better-sqlite3，绑定不可用时自动回退 Node 内置 `node:sqlite`） |
| 存储 | `data/*.json` 文件（线程锁 + 原子写） | SQLite（WAL + 事务，模式自动协商），字段原样存取 |
| 鉴权 | 无 | 管理端写操作可选 Token（读接口开放） |
| AI Key | 前端 `config.local.js` 持有 | 服务端 `ZHIPU_API_KEY` 持有 |
| 并发 | 进程内锁 | WAL 读写并发 + 单文件事务 |

`serve.py` 保留未删，可继续用于本地对照或回退。

---

## 11. 部署建议

1. `npm ci --omit=dev` 安装依赖（`better-sqlite3` 含原生模块：多数平台有预编译包；
   若构建失败也不影响启动 —— 后端会自动回退到 Node 内置 `node:sqlite`，见 §9）。
2. 用 systemd / pm2 / Docker 托管 `npm start`，配置 `PORT`、`ADMIN_TOKEN`、`ZHIPU_API_KEY`。
3. 数据库文件位于 `server/data/gym.db`，**需持久化该目录**（备份/扩容时保留 `gym.db`、`gym.db-wal`、`gym.db-shm`）。
4. 前置 Nginx / Caddy 做 TLS 与访问控制；`/admin.html` 建议限制来源 IP。
5. `better-sqlite3` 为同步驱动，单进程足够；如需多进程，需改用 `SQLITE_BUSY` 重试或换 Postgres。

### 常见问题

| 现象 | 处理 |
|---|---|
| 启动时打印 `[db] 驱动 node:sqlite（better-sqlite3 原生绑定不可用…）` | 正常降级，功能不受影响；想强制用 better-sqlite3：`npm rebuild better-sqlite3` 后再启动 |
| 启动时打印 `[db] 当前库文件不可用…将在 xxx.rebuilt 中重建` | 旧库与当前环境不兼容（如遗留 WAL 库），已自动搬迁全部记录；确认新库无误后可删除旧文件 |
| `ERR_DLOPEN_FAILED` / `NODE_MODULE_VERSION` 不匹配 | 切换 Node 大版本后原生绑定失效，执行 `npm rebuild better-sqlite3` |
| `npm install` 在 better-sqlite3 编译阶段失败 | 该平台既无预编译包又缺构建工具链；把 `better-sqlite3` 移到 `optionalDependencies` 后重新 `npm install`，后端会自动使用内置 `node:sqlite`（需 Node ≥ 22.5） |
| 停止服务时报 `SQLITE_IOERR_DELETE` 之类 | 文件系统禁止删除 `-wal/-shm`；后端已自动跳过 close 并保证数据不丢，下次启动自动恢复 |

