#!/usr/bin/env bash
# =============================================================================
# 健身器械助手 · 全量验证入口
#
# 依次运行四套测试（全部自包含，互不依赖外部服务状态）：
#   ① 契约冒烟      server/smoke.sh            → 100 项（HTTP 契约全场景）
#   ② 差分兼容      server/tests/difftest.js   →  70 步（新后端 vs 旧 serve.py 逐条比对）
#   ③ 前端数据层    server/tests/store-test.js →  25 项（API 优先 / 本地兜底 / 补传）
#   ④ 端到端联动    server/tests/e2e-test.js   →  17 项（真实前端 × 真实后端）
#   ⑤ DOM 契约      server/tests/dom-test.js   →   6 项（HTML/CSS/图标零改动 + 无悬空引用）
#
# 用法：bash server/tests/run-all.sh
# 退出码：0 = 全部通过
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

TOTAL_PASS=0
TOTAL_FAIL=0
FAILED_SUITES=()

run_suite() {
  local name="$1"; shift
  echo ""
  echo "════════════════════════════════════════════════════════════════"
  echo "  $name"
  echo "════════════════════════════════════════════════════════════════"
  if "$@"; then
    echo "  ✅ $name 通过"
  else
    echo "  ❌ $name 失败"
    FAILED_SUITES+=("$name")
  fi
}

run_suite "① 契约冒烟测试"       bash "$SERVER_DIR/smoke.sh"
run_suite "② 差分兼容测试"       node "$SERVER_DIR/tests/difftest.js"
run_suite "③ 前端数据层测试"     node "$SERVER_DIR/tests/store-test.js"
run_suite "④ 端到端联动测试"     node "$SERVER_DIR/tests/e2e-test.js"
run_suite "⑤ DOM 契约基线测试"   node "$SERVER_DIR/tests/dom-test.js"

echo ""
echo "════════════════════════════════════════════════════════════════"
if [ ${#FAILED_SUITES[@]} -eq 0 ]; then
  echo "  全部测试套件通过 ✓"
  echo "════════════════════════════════════════════════════════════════"
  exit 0
else
  echo "  失败套件：${FAILED_SUITES[*]}"
  echo "════════════════════════════════════════════════════════════════"
  exit 1
fi
