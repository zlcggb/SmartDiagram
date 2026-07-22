#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# PPT-agent-engine 标准化渲染管线（dashi render_goal_deck.sh 启发）
#
# 用法：
#   ./scripts/render-pipeline.sh <project-id> [--mode draft|standard|visual]
#
# 流程：
#   1. 校验项目数据完整性
#   2. 批量生成策划稿（如需要）
#   3. 按策略生成 IR / SVG
#   4. 编译导出 PPTX
#   5. 后校验（文案质量）
#
# 环境变量：
#   DATABASE_URL    SQLite 数据库路径
#   AI_PROVIDER     gemini | mock | openai-compatible
#   GEMINI_API_KEY  Gemini API Key（provider=gemini 时必需）
# ─────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── 参数解析 ──
PROJECT_ID=""
MODE="standard"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)
      MODE="$2"
      shift 2
      ;;
    *)
      if [[ -z "$PROJECT_ID" ]]; then
        PROJECT_ID="$1"
      fi
      shift
      ;;
  esac
done

if [[ -z "$PROJECT_ID" ]]; then
  echo "用法: render-pipeline.sh <project-id> [--mode draft|standard|visual]" >&2
  echo "" >&2
  echo "模式:" >&2
  echo "  draft    - 快速导出，优先 IR/主题模板，不强制 SVG" >&2
  echo "  standard - 平衡模式，按页策略；失败降级（推荐）" >&2
  echo "  visual   - 视觉优先，尽量 SVG；失败再降级" >&2
  exit 2
fi

echo "═══════════════════════════════════════════════════════════"
echo "  PPT-agent 渲染管线"
echo "  项目: $PROJECT_ID"
echo "  模式: $MODE"
echo "═══════════════════════════════════════════════════════════"

# ── 环境检查 ──
cd "$PROJECT_ROOT"

if [[ ! -f .env ]]; then
  if [[ -f .env.example ]]; then
    echo "⚠️  未找到 .env，从 .env.example 生成..."
    cp .env.example .env
  else
    echo "❌ 未找到 .env 或 .env.example" >&2
    exit 1
  fi
fi

# 确保依赖已安装
if [[ ! -d node_modules ]]; then
  echo "📦 安装依赖..."
  corepack pnpm install
fi

# 确保 Prisma Client 已生成
echo "🔧 生成 Prisma Client..."
corepack pnpm db:generate 2>/dev/null || true

# ── Step 1: 健康检查 ──
echo ""
echo "── Step 1: 健康检查 ──"

API_PORT="${API_PORT:-4000}"
HEALTH_URL="http://127.0.0.1:${API_PORT}/api/health"

# 检查 API 是否已在运行
if curl -s --max-time 2 "$HEALTH_URL" > /dev/null 2>&1; then
  echo "✅ API 服务已运行"
else
  echo "⚠️  API 服务未运行，请先启动: corepack pnpm dev:api"
  echo "   或使用: corepack pnpm dev"
  exit 1
fi

# 检查 AI 状态
AI_STATUS=$(curl -s "http://127.0.0.1:${API_PORT}/api/ai/status" 2>/dev/null || echo '{}')
echo "🤖 AI 状态: $AI_STATUS"

# ── Step 2: 校验项目 ──
echo ""
echo "── Step 2: 校验项目数据 ──"

PROJECT_DATA=$(curl -s "http://127.0.0.1:${API_PORT}/api/projects/${PROJECT_ID}" 2>/dev/null)
if echo "$PROJECT_DATA" | grep -q '"success":false'; then
  echo "❌ 项目不存在: $PROJECT_ID" >&2
  exit 1
fi

SLIDE_COUNT=$(echo "$PROJECT_DATA" | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log(d.data?.slides?.length ?? 0);
" 2>/dev/null || echo "0")

echo "📄 项目包含 $SLIDE_COUNT 页"

if [[ "$SLIDE_COUNT" == "0" ]]; then
  echo "❌ 项目没有页面，请先生成大纲" >&2
  exit 1
fi

# ── Step 3: 批量生成（如需要）──
echo ""
echo "── Step 3: 批量生成 ──"

if [[ "$MODE" != "draft" ]]; then
  echo "🔄 运行流水线（检索 → 策划 → 设计）..."
  PIPELINE_RESULT=$(curl -s -X POST \
    "http://127.0.0.1:${API_PORT}/api/projects/${PROJECT_ID}/run-pipeline" \
    -H "Content-Type: application/json" \
    -d "{\"includeDesign\": $([ "$MODE" = "visual" ] && echo true || echo false)}" \
    2>/dev/null || echo '{"success":false}')
  
  if echo "$PIPELINE_RESULT" | grep -q '"success":true'; then
    echo "✅ 流水线完成"
  else
    echo "⚠️  流水线部分失败，继续导出..."
  fi
else
  echo "⏩ Draft 模式，跳过生成"
fi

# ── Step 4: 导出 PPTX ──
echo ""
echo "── Step 4: 导出 PPTX ──"

THEME=$(echo "$PROJECT_DATA" | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log(d.data?.project?.theme ?? 'white-blue');
" 2>/dev/null || echo "white-blue")

echo "🎨 主题: $THEME | 模式: $MODE"

EXPORT_RESULT=$(curl -s -X POST \
  "http://127.0.0.1:${API_PORT}/api/projects/${PROJECT_ID}/export-pptx" \
  -H "Content-Type: application/json" \
  -d "{\"theme\": \"${THEME}\", \"mode\": \"${MODE}\"}" \
  2>/dev/null)

if echo "$EXPORT_RESULT" | grep -q '"success":true'; then
  PPTX_URL=$(echo "$EXPORT_RESULT" | node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    console.log(d.data?.downloadUrl ?? '');
  " 2>/dev/null || echo "")
  
  echo "✅ 导出成功: $PPTX_URL"
  
  # 提取 warnings 和 pageResults
  echo "$EXPORT_RESULT" | node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    const w = d.data?.warnings ?? [];
    const p = d.data?.pageResults ?? [];
    if (w.length) { console.log('⚠️  警告:'); w.forEach(x => console.log('  - ' + x)); }
    const grades = {};
    p.forEach(r => { grades[r.editableGrade || '?'] = (grades[r.editableGrade || '?'] || 0) + 1; });
    if (Object.keys(grades).length) {
      console.log('📊 可编辑等级: ' + Object.entries(grades).map(([k,v]) => k+'='+v).join(' / '));
    }
  " 2>/dev/null || true
else
  echo "❌ 导出失败" >&2
  echo "$EXPORT_RESULT" | head -5
  exit 1
fi

# ── Step 5: 后校验 ──
echo ""
echo "── Step 5: 后校验 ──"

# AI 用量
USAGE=$(curl -s "http://127.0.0.1:${API_PORT}/api/ai/usage" 2>/dev/null || echo '{}')
echo "📈 AI 用量:"
echo "$USAGE" | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  const c = d.data?.counts ?? {};
  Object.entries(c).forEach(([k,v]) => { if(v > 0) console.log('  ' + k + ': ' + v + ' 次'); });
" 2>/dev/null || true

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  ✅ 渲染管线完成"
echo "═══════════════════════════════════════════════════════════"
