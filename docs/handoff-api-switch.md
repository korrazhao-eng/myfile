# 前端切换真实 API 调用 · 交接任务书

> 交接对象：其他 AI / 开发者。本文档自包含，无需额外上下文。
> 前置阅读（必读）：`docs/api.md`（接口契约 V2.1，后端实现与契约完全一致）
> 仓库：`korrazhao-eng/myfile`（main 分支，最新 commit 0835cb8）

## 1. 目标

用户端从「localStorage 为主数据 + 异步上报 API」切换为「**API 为主数据，localStorage 仅作缓存与离线回退**」：

| 数据 | 现状 | 目标 |
|---|---|---|
| 教练/器械/方案/我的档案 | 已走 /api/bootstrap（store.js） | 不动 |
| 当前用户会员卡 | 已走 /api/users（fetchMe） | 不动 |
| 训练打卡记录 | localStorage `gym_chk_YYYY-MM-DD` 为主，AppStore.report 异步上报 /api/logs（失败静默） | 读写以 /api/logs 为主：生成方案/执行/日志页/摘要卡统一消费 API 数据；提交后本地写缓存兜底 |
| 教练课预约 | localStorage `gym_resv_` 为主，异步上报 /api/lessons | 同上，以 /api/lessons 为主 |
| 用户列表（后台） | 已走 /api/users | 不动 |
| 摘要卡 AI 文案 | 已走 /api/llm/summary | 不动 |

## 2. 硬约束（违反即返工）

1. **DOM 稳定**：`DOM-CONTRACT.md` 定义的 87 个 id 一字不改；js/app.js、js/admin.js 中 `$('#id')` 选择器与事件绑定不改，可改模板 class 与文案
2. **禁止修改**：js/baidu-ai.js、serve.py（保留作轻量备用）、data/*.json（存量演示数据）
3. **禁止写死业务数据**：所有数据来自 API，失败才回退内置默认值（js/data.js）
4. **失败静默**：API 不可用（如 GitHub Pages 纯静态部署）自动回退 localStorage/内置数据，不弹 Toast、不阻塞用户操作
5. **日期展示**：所有有效期类日期展示层统一 `YYYY-MM-DD`，不改原始数据源
6. **虚拟人名**：测试数据人名只能用 曹操（运营）/ 田文镜（产品）
7. **图标**：仅 icons/ 目录 SVG，禁止 emoji

## 3. 关键现状（改动落点）

- `js/store.js`：AppStore.init() 拉 bootstrap + fetchMe；AppStore.report(path, payload) 异步上报。可在 store.js 层扩展「读写 API 优先」封装，避免散落各处
- `js/app.js`：打卡 confirmRec / 预约提交 / 生成方案 / 日志页渲染 / 器械详情渲染。日志页已消费 `window.LOG_DB`（app.js 启动拉 /api/logs）
- `js/summary.js`：gatherAllDays() 聚合 window.LOG_DB + localStorage（真实记录覆盖同日演示数据）——此口径保留，只是 LOG_DB 需含用户新录入数据
- 后端：`server/`（Node+Express+SQLite），启动 `node server/src/index.js`，默认端口 8080（预览用 `PORT=8788`）；logs/lessons POST 按 date upsert（同日覆盖）；写操作鉴权仅管理端集合，logs/lessons 开放
- 摘要卡事实判定层在本地（summary.js 规则引擎），AI 只改写文案——**不要**把事实判定搬到服务端

## 4. 验收标准

1. `bash server/smoke.sh` 100/100 通过
2. 启动后端，浏览器逐屏回归：4 Tab（首页/识别/日志/我的）+ 5 子页 + 2 弹层 + 4 后台 Tab
3. 关键链路实测：
   - 完成一次训练录入 → 刷新页面后日志页/首页摘要仍显示（数据来自 API 而非仅 localStorage）
   - 提交一次预约 → 后台「课程记录」Tab 立即可见
   - 停掉后端 → 全部页面正常回退渲染（localStorage/内置数据）
4. 浏览器 Console 无新增报错（外部视频 CDN 超时可忽略）

## 5. 交付

- 单独 commit（信息格式参照 `git log`），推送到 main
- 改动清单：逐文件列出改动点与回退策略变化
- 如与本文档冲突（契约/约束），以 `docs/api.md` 为准并在改动清单中标注
