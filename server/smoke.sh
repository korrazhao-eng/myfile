#!/usr/bin/env bash
# =============================================================================
# 健身器械助手 · 后端冒烟测试
# 覆盖 docs/api.md「4. 状态码汇总」全部场景（200 / 400 / 401 / 404 / 405 / 502）
# + 每个集合至少一次增删改查断言 + 特殊语义断言（按 date upsert / 全量替换 /
#   器械发力肌群幂等补全 / id 生成 / PUT 忽略 body id）
#
# 用法：
#   bash smoke.sh                      # 自动启动隔离测试实例（独立库，结束后清理）
#   BASE_URL=http://127.0.0.1:8080 bash smoke.sh   # 测已运行的服务（需带 ADMIN_TOKEN）
#   ADMIN_TOKEN=xxx BASE_URL=... bash smoke.sh
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_URL="${BASE_URL:-}"
ADMIN_TOKEN="${ADMIN_TOKEN:-smoke-admin-token}"
OWN_SERVER=0
TMP_DIR=""
SERVER_PID=""
STUB_PID=""

PASS=0
FAIL=0
SKIP=0
FAILED_ITEMS=()

cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
  [ -n "$STUB_PID" ] && kill "$STUB_PID" 2>/dev/null
  wait 2>/dev/null
  [ -n "$TMP_DIR" ] && rm -rf "$TMP_DIR"
  return 0
}
trap cleanup EXIT

# ---------- 输出helper ----------
c_ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; PASS=$((PASS+1)); }
c_bad()  { printf '  \033[31m✗\033[0m %s\n     期望: %s\n     实际: %s\n' "$1" "$2" "$3"; FAIL=$((FAIL+1)); FAILED_ITEMS+=("$1"); }
c_skip() { printf '  \033[33m-\033[0m %s（跳过：%s）\n' "$1" "$2"; SKIP=$((SKIP+1)); }
section(){ printf '\n\033[1m%s\033[0m\n' "$1"; }

# ---------- HTTP 调用 ----------
HTTP_CODE=""; HTTP_BODY=""; HTTP_CT=""; HTTP_CACHE=""
api() { # api METHOD PATH [BODY] [auth:yes|no]
  local method="$1" path="$2" body="${3-}" auth="${4-yes}"
  local out hdr raw
  out="$(mktemp)"; hdr="$(mktemp)"
  local args=(-s -D "$hdr" -o "$out" -w '%{http_code}' -X "$method" "$BASE_URL$path")
  [ "$auth" = "yes" ] && args+=(-H "X-Admin-Token: $ADMIN_TOKEN")
  if [ -n "$body" ]; then args+=(-H 'Content-Type: application/json' --data-binary "$body"); fi
  raw="$(curl "${args[@]}")"
  HTTP_CODE="$raw"
  HTTP_CT="$(grep -i '^content-type:' "$hdr" | head -1 | tr -d '\r' | cut -d' ' -f2-)"
  HTTP_CACHE="$(grep -i '^cache-control:' "$hdr" | head -1 | tr -d '\r' | cut -d' ' -f2-)"
  HTTP_BODY="$(cat "$out")"
  rm -f "$out" "$hdr"
}

# JSON 取值（用 node 解析，避免依赖 jq）；表达式作用域内可访问 j
jqf() { printf '%s' "$HTTP_BODY" | node -e '
let s="";process.stdin.on("data",d=>{s+=d}).on("end",()=>{
  try{const j=JSON.parse(s);const v=(new Function("j","return ("+process.argv[1]+")"))(j);console.log(typeof v==="object"?JSON.stringify(v):String(v));}
  catch(e){console.log("__ERR__");}})' "$1"; }

# URL 编码（中文查询参数）
urlenc() { printf '%s' "$1" | node -e 'process.stdin.on("data",d=>process.stdout.write(encodeURIComponent(d.toString().trim())))'; }

# 判断字符串是否包含子串（case 不能直接放进 $( )，bash 语法不允许）
has() { case "$1" in *"$2"*) echo true;; *) echo false;; esac; }

expect_code() { # expect_code 描述 期望码
  if [ "$HTTP_CODE" = "$2" ]; then c_ok "$1 [$HTTP_CODE]"; else c_bad "$1" "HTTP $2" "HTTP $HTTP_CODE · ${HTTP_BODY:0:200}"; fi
}
expect_eq() { # expect_eq 描述 期望 实际
  if [ "$2" = "$3" ]; then c_ok "$1"; else c_bad "$1" "$2" "$3"; fi
}
expect_contains() { # expect_contains 描述 子串
  case "$HTTP_BODY" in *"$2"*) c_ok "$1" ;; *) c_bad "$1" "包含 '$2'" "${HTTP_BODY:0:200}" ;; esac
}

# ---------- 准备：启动隔离测试实例 ----------
if [ -z "$BASE_URL" ]; then
  TMP_DIR="$(mktemp -d)"
  STUB_LOG="$TMP_DIR/stub.log"
  node "$SCRIPT_DIR/scripts/stub-upstream.js" 0 > "$STUB_LOG" 2>&1 &
  STUB_PID=$!
  for _ in $(seq 1 40); do
    STUB_PORT="$(grep -o 'STUB_PORT=[0-9]*' "$STUB_LOG" 2>/dev/null | head -1 | cut -d= -f2)"
    [ -n "${STUB_PORT:-}" ] && break
    sleep 0.1
  done
  if [ -z "${STUB_PORT:-}" ]; then echo "无法启动上游桩服务"; exit 1; fi

  PORT="$(node -e 'const n=require("net");const s=n.createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close();});')"
  BASE_URL="http://127.0.0.1:$PORT"
  ADMIN_TOKEN="$ADMIN_TOKEN" \
  PORT="$PORT" \
  DB_PATH="$TMP_DIR/smoke.db" \
  BAIDU_UPSTREAM="http://127.0.0.1:$STUB_PORT" \
  ZHIPU_API_KEY="smoke-dummy-key" \
  ZHIPU_BASE_URL="http://127.0.0.1:$STUB_PORT" \
  node "$SCRIPT_DIR/src/index.js" > "$TMP_DIR/server.log" 2>&1 &
  SERVER_PID=$!
  READY=0
  for _ in $(seq 1 60); do
    if curl -sf -o /dev/null "$BASE_URL/api/bootstrap"; then READY=1; break; fi
    sleep 0.2
  done
  if [ "$READY" != "1" ]; then
    echo "测试实例启动失败，日志："; cat "$TMP_DIR/server.log"; exit 1
  fi
  echo "测试实例: $BASE_URL （隔离库 $TMP_DIR/smoke.db，ADMIN_TOKEN=${ADMIN_TOKEN}）"
else
  if [ "${SMOKE_ALLOW_MUTATION:-0}" != "1" ]; then
    echo "⚠️  指定 BASE_URL 会对目标库执行写操作（新增/修改/删除，且会整体替换 profile 与 plans）。"
    echo "    确认目标可写入后，追加 SMOKE_ALLOW_MUTATION=1 重新运行："
    echo "    SMOKE_ALLOW_MUTATION=1 BASE_URL=$BASE_URL bash smoke.sh"
    exit 2
  fi
  echo "测试目标: $BASE_URL （⚠️ 会对该库执行写操作）"
fi

# =============================================================================
section 'A. 启动与健康检查'
api GET /api/bootstrap
expect_code 'GET /api/bootstrap' 200
expect_eq 'bootstrap 含 coaches/equipments/profile' 'coaches,equipments,profile' "$(jqf 'Object.keys(j).join(",")')"
expect_eq 'bootstrap.coaches 是数组' 'true' "$(jqf 'Array.isArray(j.coaches)')"
expect_eq '响应带 no-cache 缓存头' 'true' "$(has "$HTTP_CACHE" 'no-cache')"
expect_eq 'Content-Type 为 UTF-8 JSON' 'true' "$(has "$HTTP_CT" 'charset=utf-8')"

# =============================================================================
section 'B. 状态码汇总（契约 §4）'
api GET /api/coaches
expect_code '200 成功 · GET 集合' 200
api GET /api/coaches
expect_code '200 成功 · GET 单条' 200

api POST /api/coaches '{"course":"缺姓名"}'
expect_code '400 · POST 缺 name' 400
expect_contains '400 错误体为 {"error":...}' '"error"'

api POST /api/coaches '{invalid json'
expect_code '400 · body 非 JSON' 400

api GET /api/unknown_collection
expect_code '404 · 未知集合' 404
api GET /api/coaches/does-not-exist
expect_code '404 · id 不存在' 404
api GET /api/definitely-not-a-static-file.html
expect_code '404 · 静态 404' 404

api POST /api/profile '[]'
expect_code '405 · profile 非 PUT' 405
api POST /api/plans '[]'
expect_code '405 · plans 非 PUT' 405
api PUT /api/coaches '{"course":"x"}'
expect_code '405 · PUT 缺 id' 405
api DELETE /api/coaches
expect_code '405 · DELETE 缺 id' 405

api POST /api/coaches '{"name":"未带 Token 的请求"}' no
if [ "$HTTP_CODE" = "401" ]; then
  c_ok '401 · Token 校验失败 [$HTTP_CODE]'
  expect_contains '401 错误体为 {"error":...}' '"error"'
else
  c_skip '401 · Token 校验失败' "服务未开启鉴权（当前 HTTP ${HTTP_CODE}）"
fi

api POST /api/llm/summary '{"messages":[{"role":"user","content":"FORCE_502"}]}'
expect_code '502 · 上游不可达（代理网络异常）' 502

# =============================================================================
section 'C. coaches 增删改查'
api POST /api/coaches '{"name":"冒烟教练","course":"测试课","tags":["T1","T2"]}'
expect_code 'POST 新增教练' 200
COACH_ID="$(jqf 'j.id')"
expect_eq '新增 id 为 8 位' '8' "${#COACH_ID}"

api GET "/api/coaches/$COACH_ID"
expect_code 'GET 新增的教练（查）' 200
expect_eq '教练姓名正确' '冒烟教练' "$(jqf 'j.name')"
expect_eq '教练 tags 正确' '["T1","T2"]' "$(jqf 'JSON.stringify(j.tags)')"

api PUT "/api/coaches/$COACH_ID" '{"course":"改过的课"}'
expect_code 'PUT 更新教练' 200
api GET "/api/coaches/$COACH_ID"
expect_eq 'PUT 合并更新：course 已改' '改过的课' "$(jqf 'j.course')"
expect_eq 'PUT 合并更新：name 保留' '冒烟教练' "$(jqf 'j.name')"

api PUT "/api/coaches/$COACH_ID" '{"id":"hacked-id","course":"再改"}'
expect_code 'PUT 带 body.id 的请求' 200
api GET "/api/coaches/$COACH_ID"
expect_eq 'PUT 忽略 body 中的 id' "$COACH_ID" "$(jqf 'j.id')"

api DELETE "/api/coaches/$COACH_ID"
expect_code 'DELETE 删除教练' 200
api GET "/api/coaches/$COACH_ID"
expect_code 'GET 已删除的教练 → 404' 404

# =============================================================================
section 'D. equipments 增删改查 + 发力肌群补全'
api POST /api/equipments '{"type":"胸部","name":"冒烟器械","muscles":["胸大肌"],"subMuscles":["肱三头肌"]}'
expect_code 'POST 新增器械' 200
EQ_ID="$(jqf 'j.id')"
api GET "/api/equipments/$EQ_ID"
expect_code 'GET 新增的器械（查）' 200
expect_eq '器械 muscles 已保存' '["胸大肌"]' "$(jqf 'JSON.stringify(j.muscles)')"
api PUT "/api/equipments/$EQ_ID" '{"muscles":["胸大肌","三角肌前束"],"safety":"注意护具"}'
expect_code 'PUT 更新器械' 200
api GET "/api/equipments/$EQ_ID"
expect_eq 'PUT 后 muscles 已更新' '["胸大肌","三角肌前束"]' "$(jqf 'JSON.stringify(j.muscles)')"
expect_eq 'PUT 后 safety 已更新' '注意护具' "$(jqf 'j.safety')"
api DELETE "/api/equipments/$EQ_ID"
expect_code 'DELETE 删除器械' 200
api GET "/api/equipments/$EQ_ID"
expect_code 'GET 已删除的器械 → 404' 404

# 幂等补全：删掉默认表内的 leg_curl，再以「缺 muscles/subMuscles」的记录重建 → GET 应被补全
api DELETE /api/equipments/leg_curl
api POST /api/equipments '{"id":"leg_curl","type":"腿部","name":"俯卧腿弯举机"}'
expect_code 'POST 缺 muscles/subMuscles 的器械' 200
api GET /api/equipments
expect_code 'GET 器械列表（触发补全）' 200
expect_eq '缺失 muscles 按默认表补全' '["腘绳肌"]' "$(jqf '(j.find(e=>e.id==="leg_curl")||{}).muscles ? JSON.stringify(j.find(e=>e.id==="leg_curl").muscles) : "MISSING"')"
expect_eq '缺失 subMuscles 按默认表补全' '["臀大肌"]' "$(jqf '(j.find(e=>e.id==="leg_curl")||{}).subMuscles ? JSON.stringify(j.find(e=>e.id==="leg_curl").subMuscles) : "MISSING"')"
api GET /api/equipments/leg_curl
expect_eq '补全后单条查询同样带字段' '["腘绳肌"]' "$(jqf 'JSON.stringify(j.muscles)')"

# =============================================================================
section 'E. users 增删改查'
api POST /api/users '{"nickname":"冒烟用户","phone":"13800001111","heart":72,"weight":68.5,"fatRate":18.2}'
expect_code 'POST 新增用户' 200
USER_ID="$(jqf 'j.id')"
api GET "/api/users/$USER_ID"
expect_code 'GET 新增的用户（查）' 200
expect_eq '用户昵称正确' '冒烟用户' "$(jqf 'j.nickname')"
api PUT "/api/users/$USER_ID" '{"heart":66,"coach":"田文镜"}'
expect_code 'PUT 更新用户' 200
api GET "/api/users/$USER_ID"
expect_eq 'PUT 后心率已改' '66' "$(jqf 'j.heart')"
expect_eq 'PUT 后昵称保留' '冒烟用户' "$(jqf 'j.nickname')"
api DELETE "/api/users/$USER_ID"
expect_code 'DELETE 删除用户' 200
api GET "/api/users/$USER_ID"
expect_code 'GET 已删除的用户 → 404' 404

# =============================================================================
section 'F. logs 按 date upsert'
api POST /api/logs '{"date":"2026-12-01","type":"solo","records":[{"action":"深蹲","sets":4,"weight":50}]}'
expect_code 'POST 训练日志' 200
api POST /api/logs '{"date":"2026-12-01","type":"solo","records":[{"action":"卧推","sets":3,"weight":30}]}'
expect_code 'POST 同日再次上报（覆盖）' 200
api GET '/api/logs?date=2026-12-01'
expect_code 'GET 按 date 过滤日志' 200
expect_eq '同日只保留 1 条（覆盖不追加）' '1' "$(jqf 'j.length')"
expect_eq '覆盖后内容为最新一条' '卧推' "$(jqf 'j[0].records[0].action')"
api GET /api/logs
expect_eq '全量日志中该日期仅 1 条' '1' "$(jqf 'j.filter(e=>e.date==="2026-12-01").length')"
api GET '/api/logs?date=2099-01-01'
expect_eq 'date 无匹配 → 空数组' '0' "$(jqf 'j.length')"

# =============================================================================
section 'G. lessons 按 date upsert + 查询过滤'
api POST /api/lessons '{"date":"2026-12-02","coachName":"冒烟教练甲","course":"力量训练课"}'
expect_code 'POST 教练课预约' 200
api POST /api/lessons '{"date":"2026-12-02","coachName":"冒烟教练乙","course":"体能提升课"}'
expect_code 'POST 同日换教练（覆盖）' 200
api GET '/api/lessons?date=2026-12-02'
expect_code 'GET 按 date 过滤课程' 200
expect_eq '同日只保留 1 条' '1' "$(jqf 'j.length')"
expect_eq '覆盖后教练为最新' '冒烟教练乙' "$(jqf 'j[0].coachName')"
api GET "/api/lessons?coach=$(urlenc '冒烟教练乙')"
expect_code 'GET 按 coach 过滤课程' 200
expect_eq 'coach 过滤命中 1 条' '1' "$(jqf 'j.length')"
api GET "/api/lessons?date=2026-12-02&coach=$(urlenc '冒烟教练乙')"
expect_code 'GET date + coach 叠加过滤' 200
expect_eq '叠加过滤命中 1 条' '1' "$(jqf 'j.length')"
api GET "/api/lessons?coach=$(urlenc '不存在的教练')"
expect_eq 'coach 无匹配 → 空数组' '0' "$(jqf 'j.length')"

# =============================================================================
section 'H. profile / plans 仅 PUT 全量替换'
api GET /api/profile
expect_code 'GET profile' 200
PROFILE_N="$(jqf 'j.length')"
api PUT /api/profile '[{"title":"心率记录","main":"最近一次 80 次/分","sub":"记录日期 2026-12-01"}]'
expect_code 'PUT profile 全量替换' 200
expect_eq 'PUT 返回 count' '1' "$(jqf 'j.count')"
api GET /api/profile
expect_eq 'profile 已被整体替换为 1 条' '1' "$(jqf 'j.length')"
expect_eq 'profile 内容为新值' '最近一次 80 次/分' "$(jqf 'j[0].main')"
api PUT /api/profile '{"title":"x"}'
expect_code 'PUT profile 非数组 → 405' 405
api DELETE /api/profile
expect_code 'DELETE profile → 405' 405

api GET /api/plans
expect_code 'GET plans' 200
api PUT /api/plans '[{"id":"back","part":"背","warmup":{"targets":"a","method":"b","standard":"c"},"steps":[],"stretch":[]}]'
expect_code 'PUT plans 全量替换' 200
expect_eq 'PUT 返回 count' '1' "$(jqf 'j.count')"
api GET /api/plans
expect_eq 'plans 已被整体替换为 1 条' '1' "$(jqf 'j.length')"
api GET /api/plans/back
expect_code 'GET 单个方案（按 id）' 200
expect_eq '方案内容正确' '背' "$(jqf 'j.part')"
api PUT /api/plans '{"id":"back"}'
expect_code 'PUT plans 非数组 → 405' 405

# =============================================================================
section 'I. 静态托管（与 serve.py 行为一致）'
api GET /
expect_code 'GET / 返回首页' 200
api GET /admin.html
expect_code 'GET /admin.html 返回管理后台' 200
api GET /js/app.js
expect_code 'GET /js/app.js 返回前端脚本' 200
api GET /@vite/client
expect_code 'GET /@vite/client 返回空脚本桩' 200
api GET /api/bootstrap
expect_code 'GET /api/bootstrap（静态不影响 API）' 200

# =============================================================================
section 'J. AI 代理 / 上游透传'
api POST /api/llm/summary '{"model":"glm-4-flash","messages":[{"role":"user","content":"生成一句训练文案"}]}'
expect_code 'POST /api/llm/summary 转发上游' 200
expect_contains 'LLM 请求体已转发上游' 'messages'
expect_contains 'LLM 响应已回传给前端' '"ok":true'
api POST /api/llm/summary '{"foo":1}'
expect_code 'POST /api/llm/summary 缺 messages → 400' 400
api POST /api/llm/summary '{invalid'
expect_code 'POST /api/llm/summary 非法 JSON → 400' 400

api POST /proxy/echo '{"ping":1}'
expect_code 'POST /proxy/* 透传上游' 200
expect_eq '代理原样透传 body' '{"ping":1}' "$(jqf 'j.body')"
expect_eq '代理原样透传 method' 'POST' "$(jqf 'j.method')"
api GET /proxy/echo
expect_code 'GET /proxy/* 透传上游' 200
expect_eq 'GET 透传 method' 'GET' "$(jqf 'j.method')"
api POST /proxy/boom '{}'
expect_code 'POST /proxy/* 上游断连 → 502' 502

# =============================================================================
printf '\n\033[1m===== 冒烟测试结果 =====\033[0m\n'
printf '  通过: \033[32m%d\033[0m   失败: \033[31m%d\033[0m   跳过: \033[33m%d\033[0m\n' "$PASS" "$FAIL" "$SKIP"
if [ "$FAIL" -gt 0 ]; then
  printf '\n失败项：\n'
  for it in "${FAILED_ITEMS[@]}"; do printf '  - %s\n' "$it"; done
  exit 1
fi
printf '  \033[32m全部通过 ✓\033[0m\n'
exit 0
