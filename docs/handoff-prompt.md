# 交给下一个 AI 的复核提示词

> 用途：把本仓库的交付物交给一个**全新的、没有任何上下文**的 AI（或其他复核者）做独立检查。
> 用法：整段复制 `docs/handoff-prompt.md` 中「提示词正文」一节，粘贴给对方即可。
> 自检：本文档所有命令与数字均在 2026-11-09 于本机实测通过。

---

## 提示词正文（以下内容可直接复制）

````markdown
你是一位独立代码审查者。请对「健身器械助手」项目的一次交付做**独立复核**。

你的立场是**怀疑者**，不是复述者。仓库里有一份作者写的交接文档（`docs/handoff-review.md`），
但**不要相信它**——它由交付者本人撰写，天然有自证偏差。你的任务是用代码和运行结果
独立验证文档里的每一条声明，并在发现问题时给出可复现的证据。

---

## 0. 环境与代码位置

- 项目路径：`/Users/zhao/Downloads/trae/product_manager/gym-app`
- 远端仓库：`korrazhao-eng/myfile`，分支 `main`，HEAD = `141652a`
- 运行时：本机 `node` v22.22.2，`python3` 3.13.12
- 网络：存在 `HTTP_PROXY` 环境变量，**访问本机必须加 `--noproxy '*'`**

```bash
cd /Users/zhao/Downloads/trae/product_manager/gym-app
git log --oneline -10
git status --short          # 期望为空（工作树干净）
```

---

## 1. 复核范围：只审这 3 个提交

本次交付由 **3 个提交**构成，其余提交是**并行工作线**，不在本次范围内：

| 提交 | 阶段 | 内容 |
|---|---|---|
| `1418c50` | 阶段一 | 生产级后端（Node + Express + SQLite）替换旧 `serve.py` 模拟后端 |
| `42e27b6` | 阶段一 | 存储层韧性：`better-sqlite3` / `node:sqlite` 双驱动自动回退 |
| `9159fde` | 阶段二 | 前端数据层切换为「API 为主数据 + localStorage 缓存兜底」 |

后续两个提交 `06c20e6`（复核材料与测试脚本入库）、`141652a`（差分测试修复）属于交付的补充。

**明确不在范围内**（并行工作线，请勿算作本次的功过）：
`566dab3`（会员卡/日志可维护）、`0835cb8`（guide 字段 + mappings 集合）、`060483a`（任务书）。

```bash
git show --stat 1418c50 42e27b6 9159fde
```

---

## 2. 原始需求（验收基准）

### 阶段一 · 生产级后端

用 Node.js + Express + `better-sqlite3` 替换本地模拟后端 `serve.py`，**完全兼容现有接口契约，前端零改动**。

硬性要求：
1. 默认端口 8080，`PORT` 可覆盖；静态托管 `gym-app/`。
2. 所有响应带 `Cache-Control: no-cache`，UTF-8 JSON，错误统一为 `{"error":"原因"}`。
3. `POST /api/logs`、`POST /api/lessons` 按 `date` upsert。
4. `PUT /api/profile`、`PUT /api/plans` 仅接受 JSON 数组，其他方法返回 405。
5. `POST /api/equipments` 缺 `muscles`/`subMuscles` 时幂等补全。
6. `POST /api/coaches`、`POST /api/equipments` 缺 `name` 返回 400。
7. `POST` 生成 8 位 id；`PUT` 忽略 body 里的 id。
8. `GET /api/lessons` 支持 `?date=`、`?coach=`；`GET /api/logs` 支持 `?date=`。
9. `GET /api/bootstrap` 聚合 coaches / equipments / profile。
10. 写操作需 `ADMIN_TOKEN` + `X-Admin-Token` 头；读接口开放。
11. 新增 `POST /api/llm/summary`，`ZHIPU_API_KEY` 保持在服务端，不下发前端。
12. 提供幂等迁移脚本、冒烟测试脚本、README。

### 阶段二 · 前端切换真实 API

把用户端数据层从「localStorage 为主 + API 异步上报」改为「**API 为主数据，localStorage 仅作缓存与离线回退**」。

硬性要求：
1. 教练 / 器械 / 方案 / 档案 / 会员卡 / 用户列表 / 摘要 AI **不改**。
2. 训练日志与教练预约统一以 `/api/logs`、`/api/lessons` 为主。
3. DOM id、`js/app.js` / `js/admin.js` 选择器与事件绑定保持稳定；**HTML、CSS、图标零改动**。
4. 禁止修改 `js/baidu-ai.js`、`serve.py`、`data/*.json`。
5. API 不可用时**静默回退**（不得向用户抛错、不得产生 Console 报错）。
6. 日期统一 `YYYY-MM-DD`。

---

## 3. 先跑通，再挑毛病

```bash
cd /Users/zhao/Downloads/trae/product_manager/gym-app/server
npm install          # 仅 express + better-sqlite3
cd ..
bash server/tests/run-all.sh
```

期望：五套套件全绿，合计 **218 项断言**（① 冒烟 100 · ② 差分 70 · ③ 前端数据层 25 · ④ 端到端 17 · ⑤ DOM 契约 6）。

**环境注意**：
- `npm install` 在受限网络下可能卡在 `better-sqlite3` 原生模块重建。若卡住，`express` 装好后即可继续——
  后端会自动回退 Node 内置 `node:sqlite`，测试照常可跑。
- 强制走回退路径验证：`DB_DRIVER=node:sqlite bash server/tests/run-all.sh`
- 五套脚本全部自包含（自动拉起隔离实例、临时数据目录、结束自动清理），互不干扰。

### 手动起服务做人工验收

```bash
cd server && npm start                       # 默认 8080
curl -s --noproxy '*' http://127.0.0.1:8080/api/bootstrap | head -c 400
# 用户端 http://127.0.0.1:8080/    管理后台 http://127.0.0.1:8080/admin.html
```

---

## 4. 请重点审查的方向（按可疑度排序）

> 以下是**待验证的假设**，不是已知结论。请用代码或实验确认或推翻。

### 4.1 兼容性判定规则是否过宽（最高优先级）

`server/tests/difftest.js` 的判定规则是「**递归子集语义**」：新后端必须提供旧后端的全部数据
（字段不丢、值不改、记录不减），但允许新增字段 / 键 / 记录。

**风险**：这条规则如果写松了，真正的回归就会被放过。请做以下检验：
- 规则是否真能抓到「顶层键丢失」「集合内字段值被篡改」「记录被少删一条」三类回归？
- 新增的白名单键（如 `mappings`）是否合理，还是掩盖了真实差异？
- 「新后端多返回字段」一律放行，是否会掩盖契约破坏（例如某个字段名拼错、前端读不到）？

**建议做法**：在 `/tmp` 拷贝一份仓库，故意注入上述三类回归，看测试是否报错并精确定位。

### 4.2 「API 为主数据」是否真的成立

阶段二对 `js/` 的全部实质改动共 4 文件、+414/−113 行：
`js/store.js` +344/−9（主体）、`js/app.js` +56/−69、`js/summary.js` +9/−33、`js/admin.js` +5/−2。

核心实现位置（已核实）：
- `js/store.js:274` `gatherDays()` —— API 优先 → 本地缓存 → `js/data.js` 内置数据
- `js/store.js:373` `saveLog()` / `:388` `saveLesson()` —— 先写本地并标记 `_synced=false`，POST 成功后置已同步
- `js/store.js:404` `deleteLog()` / `:418` `syncPending()` —— 删除同步与启动自动补传

请验证：
- API 返回的数据是否**优先**于本地缓存？删除操作是否会「复活」？
- 离线补传（`syncPending()`）在并发 / 失败 / 重复提交场景下是否安全？会不会重复上传产生重复记录？
- 同一逻辑日期（时区、前后端解析）会不会错位一天？
- 是否存在「API 失败时静默回退掩盖了真实故障」的**过度静默**？（约束要求静默回退，但要判断静默是否过头）

### 4.3 鉴权边界

实现位于 `server/src/auth.js`，写操作守卫在 `server/src/routes/api.js:80 / 120 / 149`。

已核实的实现事实（请据此验证，不要重新摸索）：
- `safeEqual()` 用 `crypto.timingSafeEqual`，但**长度不等时直接 return false** —— 长度信息仍会通过响应时间泄漏（可接受，但要确认你的判断）。
- `extractToken()` 的取值顺序是：`X-Admin-Token` 头 → `gym_admin_token` Cookie → **`?admin_token=` query 参数**。

**请重点验证以下三点（交接文档均未提及）：**

1. **query 参数传 Token 的副作用** ——
   `?admin_token=` 会让密钥进入浏览器历史、Referer 头、反向代理访问日志。
   这是否应当被视为生产环境缺陷？是否影响 `/api/llm/summary` 这类敏感路径？
2. **`ADMIN_TOKEN` 为空时鉴权整体关闭** ——
   `enabled()` 返回 false → `requireAdmin` 直接 `next()`，所有写接口裸奔。
   请评估：生产部署若忘记配置该环境变量会怎样？README 是否给出了足够的醒目提示？
   这是否与「生产级后端」的定位冲突？
3. **`/admin.html` 下发 HttpOnly Cookie `gym_admin_token`** ——
   请检查这条路径是否引入 CSRF 风险（配合 CORS 默认策略），
   以及 cookie 是否缺失 `SameSite` / `Secure` 属性。

- 管理端集合（coaches / equipments / users / profile / plans）写操作是否**真的**都挂了 `requireAdmin`？请逐条核对，别只看这一处的守卫。
- `logs` / `lessons` 刻意开放写（理由：用户端上报链路）。**这是设计选择，不是缺陷**，
  但请评估风险，并判断是否与「生产级」定位冲突。

### 4.4 AI Key 是否真的下沉到服务端

前端只能传 `messages`，`ZHIPU_API_KEY` 不得出现在任何前端文件、HTML、静态资源中。

```bash
grep -rn "ZHIPU\|zhipu\|api_key\|apiKey" js/ *.html
```

### 4.5 存储层在不同机器上的稳定性

`server/src/sqlite-driver.js` + `server/src/db.js` 声称有：子进程探针、双驱动回退、WAL 模式协商、安全关闭。

已核实的实现事实：
- `probeBetterSqlite()` 在**子进程**里跑真实读写，失败重试一次；结果按「better-sqlite3 版本 + Node ABI + 绑定文件大小/mtime」指纹缓存到 `.driver-probe.json`。
- `node:sqlite` 适配层用 `BEGIN/COMMIT` + `SAVEPOINT gym_sp_<depth>` 实现嵌套事务。
- `db.js` 日志模式协商顺序：WAL → TRUNCATE → MEMORY。
- `close()` 在受限文件系统里**只 checkpoint 不 close**（`db.js:196`），理由是 WAL 模式 close 会删除 `-wal/-shm`，受限环境删除可能触发进程强杀。

**请重点验证：**
1. 指纹缓存的失效逻辑是否正确？例如手改了 Node 版本但 ABI 号恰好相同、绑定文件被替换但大小与 mtime 精度不足 —— 会不会拿到**过期的自检结论**？
2. `SAVEPOINT gym_sp_<depth>` 的命名在**异常嵌套回滚**后，`txDepth` 是否一定归位？能否出现 `txDepth` 与实际嵌套层数不同步，导致后续事务被错误地并入外层？
3. 「只 checkpoint 不 close」的路径下，数据库句柄是否泄漏？进程退出时数据是否保证落盘？
4. WAL → TRUNCATE → MEMORY 的回退是否会**静默降级**（用户以为有 WAL 持久性，实际是 MEMORY）？启动日志是否清楚告知？
5. 回退路径下事务语义是否与 `better-sqlite3` 路径**完全一致**？建议直接对比跑同一组用例。

驱动可强制指定：`DB_DRIVER` 支持 `auto`（默认）/ `better-sqlite3` / `node:sqlite`。

### 4.6 硬约束是否被违反

- HTML / CSS / 图标**零改动**：`server/tests/dom-test.js` 用基线指纹校验，
  基线取自 `060483a`（阶段二改动前）。请确认这个基线**确实**是改动前的版本，而不是事后伪造的。
  ```bash
  git diff 060483a HEAD --stat -- index.html admin.html css/ icons/   # 期望为空
  ```
  已核实该 diff 为空（129 个 id：index 64 + admin 65，零增删）。
- `js/baidu-ai.js`、`serve.py`、`data/*.json` 在阶段二是否被改动？
- **`js/admin.js` 有一处自认的越界改动**：`fmtCnDate()` 定义在 `js/admin.js:207`，
  3 处调用在 `:232`（×2）与 `:246`。交付者主张它是纯展示层。
  **请独立判断**：把「2026 年 10 月 11 日」转成 `2026-10-11` 的正则 `/(\d{4}) 年 (\d{1,2}) 月 (\d{1,2}) 日/g`
  是否可能误伤业务数据？比如某个自由文本字段里恰好含有这个模式，被转换后**写回**数据库会不会造成数据污染？
  请追踪这 3 处的数据流：读出来 → 转换 → 是否可能回写。

### 4.7 契约与实现的一致性

`docs/api.md` 是契约，`server/src/routes/api.js` 是实现。请**逐条比对**，重点：
状态码、错误体格式、id 生成规则、PUT 是否忽略 body id、按 date upsert 的键规则、
`equipments` 肌群补全的幂等性、`plans` 全量替换语义。

> **提示**：自动化测试和契约文档同出于交付者一人之手，存在「测试照着实现写」的结构性偏差风险。
> 这一节**建议手工比对**，不要只依赖 `smoke.sh` 的绿灯。

### 4.8 前端数据正确性

- 日期格式是否处处统一为 `YYYY-MM-DD`？有没有中文自然语言日期漏网？
- `js/summary.js:119` 的排序比较器：
  `fbPool.sort((a, b) => PRI[a.state] - PRI[b.state] || (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))`
  同日期返回 `0`（正确）。请验证：**同一优先级 + 同一日期**时，排序是否稳定、是否依赖引擎的稳定排序保证。
- 反馈取 `fbPool.slice(0, 2)` —— 同日多条反馈时，选出的两条是否总符合产品预期？

---

## 5. 已声明的偏离（请独立判断是否可接受）

| # | 偏离 | 交付者主张 |
|---|---|---|
| 1 | `js/admin.js` 日期格式统一 | 纯展示层，回退成本极低 |
| 2 | 契约用 `solo`/`coach`/`submittedAt`，实现用 `type`/`records`/`createdAt` | 写侧保持现状、读侧兼容两种 |
| 3 | 任务书引用的 `DOM-CONTRACT.md` 在仓库中不存在 | 改用实际 129 个 id（64+65）作为等价基线 |
| 4 | `logs`/`lessons` 无鉴权 | 用户端上报链路需要 |
| 5 | `gym_plan_<date>` 仍在 localStorage | `/api/plans` 不含「今天练哪个部位」 |

---

## 6. 交付要求

请输出一份结构化复核报告，包含：

1. **结论**：通过 / 有条件通过 / 不通过（一句话）
2. **复现记录**：你实际跑了什么命令、结果是什么（贴关键输出，不要只写「测试通过」）
3. **问题清单**：每条含
   - 严重级别（阻断 / 严重 / 一般 / 建议）
   - 位置（`文件:行号`）
   - 问题描述
   - **可复现步骤或触发条件**
   - 修复建议
4. **对偏离表的独立判断**：逐条给出「接受 / 不接受 + 理由」
5. **你额外发现、交接文档没提的问题**
6. **明确说明你没能验证的部分**（例如环境受限、缺少外部依赖）——不要假装全部验过

### 审查纪律

- **不要修改任何代码**。这是只读复核。需要做破坏性实验时，请复制到 `/tmp` 下操作。
- 不要为了让测试变绿而修改测试或基线文件。
- 声称「测试通过」时，务必贴出实际输出。
- 报告里区分「我验证过的」与「我读代码推断的」，不要混为一谈。
````

---

## 附：给人类复核者的补充

如果交给的是**人**而非 AI，额外提醒这三点：

1. **不要只跑 `run-all.sh` 就签字** —— 五套测试都是交付者写的。先做 §4.1 的注入回归实验，
   确认测试本身能抓到问题，再信任它的绿灯。
2. **重点看 `git diff 060483a HEAD -- js/`**（约 500 行）—— 阶段二的全部实质改动都在这，
   `docs/handoff-review.md` §2.4 有逐项对照表。
3. **§4.7 的契约逐条比对**建议手工做 —— 自动化测试和契约文档同出于交付者一人之手，
   存在「测试照着实现写」的结构性偏差风险。
