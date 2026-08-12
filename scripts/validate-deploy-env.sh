#!/usr/bin/env bash
# 部署前环境变量：只读校验，或显式合并旧文件后校验
#
# 用法:
#   bash scripts/validate-deploy-env.sh              # 仅校验
#   bash scripts/validate-deploy-env.sh --merge-legacy  # 合并缺失键后校验
#   bash scripts/validate-deploy-env.sh --warn-only     # 只警告不退出（供调试）
#
# deploy.sh 在构建/备份前会自动调用（含 --merge-legacy）。

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
EXAMPLE_FILE="$ROOT_DIR/.env.example"
MERGE_LEGACY=false
WARN_ONLY=false

RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

ERRORS=0
WARNINGS=0

usage() {
  cat <<'EOF'
用法: bash scripts/validate-deploy-env.sh [选项]

选项:
  --merge-legacy  从 backend/.env、ppt-agent-engine/.env 等旧文件合并缺失键到根 .env（不覆盖已有值）
  --warn-only     校验失败只警告，退出码仍为 0
  -h, --help      显示帮助

校验项:
  - 根 .env 存在，且包含 .env.example 声明的键
  - DIAGRAM_DATABASE_URL → smartdiagram；DATABASE_URL → ppt_agent（不可混用）
  - DB_PASSWORD 与连接串中的密码一致
  - PPT_INTERNAL_API_SECRET 长度 ≥ 32
  - Diagram OPENAI_API_KEY 非占位符
  - PPT AI 密钥（非 mock 时）
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --merge-legacy) MERGE_LEGACY=true ;;
    --warn-only) WARN_ONLY=true ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "未知参数: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
  shift
done

fail() {
  ERRORS=$((ERRORS + 1))
  echo -e "${RED}❌ $1${NC}" >&2
}

warn() {
  WARNINGS=$((WARNINGS + 1))
  echo -e "${YELLOW}⚠️  $1${NC}" >&2
}

ok() {
  echo -e "${GREEN}   ✅ $1${NC}"
}

info() {
  echo -e "${CYAN}ℹ  $1${NC}"
}

strip_quotes() {
  local value="$1"
  value="${value%$'\r'}"
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  printf '%s' "$value"
}

# 读取 .env 中最后一个 KEY= 的值（忽略注释行）
env_get() {
  local file="$1"
  local key="$2"
  local line value=""
  [ -f "$file" ] || return 1
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      "${key}"=*) value="${line#*=}" ;;
    esac
  done <"$file"
  strip_quotes "$value"
}

env_has_key() {
  local file="$1"
  local key="$2"
  grep -Eq "^[[:space:]]*${key}=" "$file" 2>/dev/null
}

is_placeholder() {
  local value="$1"
  case "$value" in
    ""|"sk-your-api-key"|"your-api-key"|"your-openai-api-key"|"your-gemini-api-key"|"replace-with-a-long-random-value"|"smartdiagram-ppt-internal-dev-change-me"|"smartdiagram-dev-session-secret-change-me"|"smartdiagram-dev-altcha-hmac-key-change-me") return 0 ;;
  esac
  return 1
}

is_disabled_boolean() {
  local value
  value="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  case "$value" in
    false|0|no|off) return 0 ;;
  esac
  return 1
}

db_name_from_url() {
  local url="$1"
  local path
  path="${url%%\?*}"
  path="${path##*/}"
  printf '%s' "$path"
}

password_from_pg_url() {
  local url="$1"
  # postgresql(+asyncpg)://user:pass@host/db
  if [[ "$url" =~ ://([^:/]+):([^@]+)@ ]]; then
    printf '%s' "${BASH_REMATCH[2]}"
    return 0
  fi
  return 1
}

merge_key_from_legacy() {
  local legacy_file="$1"
  local legacy_label="$2"
  local rename_key="${3:-}"
  local line key value target_key appended=0

  [ -f "$legacy_file" ] || return 0

  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      ""|\#*) continue ;;
      *=*) ;;
      *) continue ;;
    esac
    key="${line%%=*}"
    key="$(printf '%s' "$key" | tr -d '[:space:]')"
    value="${line#*=}"
    [ -n "$key" ] || continue

    target_key="$key"
    if [ -n "$rename_key" ]; then
      target_key="$rename_key"
    fi

    if env_has_key "$ENV_FILE" "$target_key"; then
      continue
    fi

    if [ "$appended" -eq 0 ]; then
      {
        printf '\n# --- merged missing keys from %s (%s) ---\n' "$legacy_label" "$(date +%Y-%m-%d)"
      } >>"$ENV_FILE"
      appended=1
      info "从 ${legacy_label} 合并缺失键到根 .env（不覆盖已有值）"
    fi
    printf '%s=%s\n' "$target_key" "$value" >>"$ENV_FILE"
    ok "已合并 ${target_key} ← ${legacy_label}"
  done <"$legacy_file"
}

merge_legacy_env_files() {
  local backend_legacy="$ROOT_DIR/backend/.env"
  local ppt_legacy="$ROOT_DIR/ppt-agent-engine/.env"
  local diagram_local="$ROOT_DIR/apps/api-diagram/.env"
  local merged_any=0

  if [ -f "$backend_legacy" ]; then
    merge_key_from_legacy "$backend_legacy" "backend/.env" "" || true
    if ! env_has_key "$ENV_FILE" "DIAGRAM_DATABASE_URL"; then
      local old_db
      old_db="$(env_get "$backend_legacy" "DATABASE_URL" || true)"
      if [ -n "$old_db" ] && [[ "$(db_name_from_url "$old_db")" == "smartdiagram" ]]; then
        if ! env_has_key "$ENV_FILE" "DIAGRAM_DATABASE_URL"; then
          printf '\n# --- merged from backend/.env DATABASE_URL ---\nDIAGRAM_DATABASE_URL=%s\n' "$old_db" >>"$ENV_FILE"
          ok "已合并 DIAGRAM_DATABASE_URL ← backend/.env 的 DATABASE_URL"
          merged_any=1
        fi
      fi
    fi
    merged_any=1
  fi

  if [ -f "$ppt_legacy" ]; then
    merge_key_from_legacy "$ppt_legacy" "ppt-agent-engine/.env" "" || true
    merged_any=1
  fi

  if [ -f "$diagram_local" ]; then
    local has_content
    has_content="$(grep -Ev '^[[:space:]]*(#|$)' "$diagram_local" | head -n 1 || true)"
    if [ -n "$has_content" ]; then
      merge_key_from_legacy "$diagram_local" "apps/api-diagram/.env" "" || true
      if ! env_has_key "$ENV_FILE" "DIAGRAM_DATABASE_URL"; then
        local local_db
        local_db="$(env_get "$diagram_local" "DATABASE_URL" || true)"
        if [ -n "$local_db" ] && [[ "$(db_name_from_url "$local_db")" == "smartdiagram" ]]; then
          printf '\n# --- merged from apps/api-diagram/.env DATABASE_URL ---\nDIAGRAM_DATABASE_URL=%s\n' "$local_db" >>"$ENV_FILE"
          ok "已合并 DIAGRAM_DATABASE_URL ← apps/api-diagram/.env"
        fi
      fi
      merged_any=1
    fi
  fi

  if [ "$merged_any" -eq 1 ]; then
    info "合并完成；请检查根 .env 中双库 URL 是否正确"
  fi
}

ensure_root_env_keys() {
  # shellcheck source=scripts/ensure-root-env.sh
  source "$ROOT_DIR/scripts/ensure-root-env.sh"
  local status
  status="$(ensure_root_env "$ROOT_DIR")"
  case "$status" in
    created)
      warn "已从 .env.example 创建根 .env，请先填入真实配置"
      ;;
    appended)
      warn "已向根 .env 追加 .env.example 中的缺失键，请确认并填入真实值"
      ;;
    ok) ok "根 .env 键齐全（相对 .env.example）" ;;
    *)
      fail "根 .env 初始化失败"
      return 1
      ;;
  esac
}

validate_root_env_keys() {
  local line key

  if [ ! -f "$ENV_FILE" ]; then
    fail "缺少 $ENV_FILE；请先从 .env.example 创建，默认校验不会写入文件"
    return 1
  fi

  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      ""|\#*) continue ;;
      *=*) ;;
      *) continue ;;
    esac
    key="${line%%=*}"
    key="$(printf '%s' "$key" | tr -d '[:space:]')"
    [ -n "$key" ] || continue
    if ! env_has_key "$ENV_FILE" "$key"; then
      fail "根 .env 缺少键: $key（运行 --merge-legacy 可显式补齐模板键）"
    fi
  done <"$EXAMPLE_FILE"
}

validate_dual_database() {
  local diagram_url ppt_url ppt_url_alt diagram_db ppt_db root_db

  diagram_url="$(env_get "$ENV_FILE" "DIAGRAM_DATABASE_URL" || true)"
  ppt_url="$(env_get "$ENV_FILE" "DATABASE_URL" || true)"
  ppt_url_alt="$(env_get "$ENV_FILE" "PPT_DATABASE_URL" || true)"

  if [ -z "$diagram_url" ]; then
    fail "缺少 DIAGRAM_DATABASE_URL（图表库 smartdiagram）"
  else
    diagram_db="$(db_name_from_url "$diagram_url")"
    if [ "$diagram_db" != "smartdiagram" ]; then
      fail "DIAGRAM_DATABASE_URL 应指向 smartdiagram，当前库名: ${diagram_db:-<无法解析>}"
    else
      ok "DIAGRAM_DATABASE_URL → smartdiagram"
    fi
  fi

  if [ -z "$ppt_url" ]; then
    fail "缺少 DATABASE_URL（PPT 库 ppt_agent，Prisma 约定）"
  else
    ppt_db="$(db_name_from_url "$ppt_url")"
    if [ "$ppt_db" != "ppt_agent" ]; then
      fail "根 .env 的 DATABASE_URL 应指向 ppt_agent，当前: ${ppt_db:-<无法解析>}（勿与图表库混用）"
    else
      ok "DATABASE_URL → ppt_agent"
    fi
  fi

  if [ -n "$ppt_url_alt" ] && [ "$ppt_url_alt" != "$ppt_url" ]; then
    warn "PPT_DATABASE_URL 与 DATABASE_URL 不一致，建议保持相同"
  fi

  # 根 .env 不应把 smartdiagram 写在 DATABASE_URL（常见迁移错误）
  if [ -n "$ppt_url" ] && [[ "$(db_name_from_url "$ppt_url")" == "smartdiagram" ]]; then
    fail "DATABASE_URL 指向了 smartdiagram：请改用 DIAGRAM_DATABASE_URL，DATABASE_URL 留给 ppt_agent"
  fi
}

validate_db_password() {
  local db_password diagram_url ppt_url url_pass

  db_password="$(env_get "$ENV_FILE" "DB_PASSWORD" || true)"
  if [ -z "$db_password" ]; then
    warn "未设置 DB_PASSWORD（将使用 compose 默认值 smartdiagram_secret）"
    db_password="smartdiagram_secret"
  fi

  diagram_url="$(env_get "$ENV_FILE" "DIAGRAM_DATABASE_URL" || true)"
  ppt_url="$(env_get "$ENV_FILE" "DATABASE_URL" || true)"

  if [ -n "$diagram_url" ]; then
    url_pass="$(password_from_pg_url "$diagram_url" || true)"
    if [ -n "$url_pass" ] && [ "$url_pass" != "$db_password" ]; then
      warn "DIAGRAM_DATABASE_URL 中的密码与 DB_PASSWORD 不一致（Docker 部署时 compose 以 DB_PASSWORD 为准）"
    fi
  fi

  if [ -n "$ppt_url" ]; then
    url_pass="$(password_from_pg_url "$ppt_url" || true)"
    if [ -n "$url_pass" ] && [ "$url_pass" != "$db_password" ]; then
      warn "DATABASE_URL 中的密码与 DB_PASSWORD 不一致"
    fi
  fi

  ok "DB_PASSWORD 已配置"
}

validate_secrets_and_keys() {
  local ppt_secret openai_key ai_provider ppt_key

  ppt_secret="$(env_get "$ENV_FILE" "PPT_INTERNAL_API_SECRET" || true)"
  if is_placeholder "$ppt_secret" || [ "${#ppt_secret}" -lt 32 ]; then
    fail "PPT_INTERNAL_API_SECRET 未配置或少于 32 字节（deploy 会自动生成，若仍失败请手动设置）"
  else
    ok "PPT_INTERNAL_API_SECRET 长度合格"
  fi

  openai_key="$(env_get "$ENV_FILE" "OPENAI_API_KEY" || true)"
  if is_placeholder "$openai_key"; then
    fail "OPENAI_API_KEY（Diagram 分区）仍为占位符或未设置"
  else
    ok "OPENAI_API_KEY 已配置"
  fi

  ai_provider="$(env_get "$ENV_FILE" "AI_PROVIDER" || true)"
  ai_provider="${ai_provider:-openai-compatible}"
  case "$ai_provider" in
    mock)
      ok "PPT AI_PROVIDER=mock，跳过 AI 密钥检查"
      ;;
    gemini)
      ppt_key="$(env_get "$ENV_FILE" "GEMINI_API_KEY" || true)"
      if is_placeholder "$ppt_key"; then
        fail "AI_PROVIDER=gemini 但 GEMINI_API_KEY 未配置"
      else
        ok "PPT GEMINI_API_KEY 已配置"
      fi
      ;;
    *)
      ppt_key="$(env_get "$ENV_FILE" "OPENAI_COMPATIBLE_API_KEY" || true)"
      if is_placeholder "$ppt_key"; then
        fail "PPT OPENAI_COMPATIBLE_API_KEY 未配置（或设置 AI_PROVIDER=mock 用于演示）"
      else
        ok "PPT OPENAI_COMPATIBLE_API_KEY 已配置"
      fi
      ;;
  esac
}

validate_deploy_platform() {
  local gateway_port auth_secret

  gateway_port="$(env_get "$ENV_FILE" "GATEWAY_PORT" || true)"
  gateway_port="${gateway_port:-9237}"
  if [ "$gateway_port" = "80" ]; then
    warn "GATEWAY_PORT=80 可能与宝塔/宿主机 Nginx 冲突，建议使用 9237"
  else
    ok "GATEWAY_PORT=${gateway_port}"
  fi

  auth_secret="$(env_get "$ENV_FILE" "AUTH_SESSION_SECRET" || true)"
  if is_placeholder "$auth_secret"; then
    warn "AUTH_SESSION_SECRET 仍为占位符（deploy 应已自动生成，请重新运行 deploy）"
  fi
}

validate_production_auth() {
  local local_login show_demo_presets

  local_login="$(env_get "$ENV_FILE" "AUTH_LOCAL_LOGIN_ENABLED" || true)"
  show_demo_presets="$(env_get "$ENV_FILE" "AUTH_SHOW_DEMO_PRESETS" || true)"

  if is_disabled_boolean "$local_login"; then
    ok "生产测试账号登录已关闭"
  else
    fail "生产部署禁止启用 AUTH_LOCAL_LOGIN_ENABLED"
  fi

  if is_disabled_boolean "$show_demo_presets"; then
    ok "生产登录页测试账号入口已关闭"
  else
    fail "生产部署禁止启用 AUTH_SHOW_DEMO_PRESETS"
  fi
}

detect_stale_legacy_files() {
  local found=0
  for legacy in \
    "$ROOT_DIR/backend/.env" \
    "$ROOT_DIR/ppt-agent-engine/.env" \
    "$ROOT_DIR/frontend/.env"; do
    if [ -f "$legacy" ]; then
      found=1
      if [ "$MERGE_LEGACY" = true ]; then
        warn "仍存在旧文件 $(basename "$(dirname "$legacy")")/$(basename "$legacy")，确认根 .env 已完整后可删除以免混淆"
      else
        warn "检测到旧 env: $(basename "$(dirname "$legacy")")/$(basename "$legacy")，建议运行: bash scripts/validate-deploy-env.sh --merge-legacy"
      fi
    fi
  done
  if [ "$found" -eq 0 ]; then
    ok "未发现需合并的旧 .env 路径"
  fi
}

validate_deploy_env() {
  local root_dir="${1:-$ROOT_DIR}"
  ROOT_DIR="$root_dir"
  ENV_FILE="$root_dir/.env"
  EXAMPLE_FILE="$root_dir/.env.example"
  ERRORS=0
  WARNINGS=0

  echo -e "${CYAN}╔══════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║   部署前环境变量检查                      ║${NC}"
  echo -e "${CYAN}╚══════════════════════════════════════════╝${NC}"
  echo ""

  if [ ! -f "$EXAMPLE_FILE" ]; then
    fail "缺少 $EXAMPLE_FILE"
    return 1
  fi

  if [ "$MERGE_LEGACY" = true ]; then
    info "合并旧环境文件中的缺失键..."
    merge_legacy_env_files
    ensure_root_env_keys || return 1
    echo ""
  fi

  validate_root_env_keys || return 1

  info "校验双库与密钥..."
  validate_dual_database
  validate_db_password
  validate_secrets_and_keys
  validate_deploy_platform
  validate_production_auth
  echo ""
  detect_stale_legacy_files
  echo ""

  if [ "$ERRORS" -gt 0 ]; then
    echo -e "${RED}环境变量检查未通过：${ERRORS} 个错误，${WARNINGS} 个警告${NC}"
    echo -e "${YELLOW}请编辑 ${ENV_FILE} 后重试，或本地运行: bash scripts/validate-deploy-env.sh --merge-legacy${NC}"
    if [ "$WARN_ONLY" = true ]; then
      return 0
    fi
    return 1
  fi

  if [ "$WARNINGS" -gt 0 ]; then
    echo -e "${YELLOW}检查通过，但有 ${WARNINGS} 个警告${NC}"
  else
    echo -e "${GREEN}✅ 环境变量检查全部通过，可以继续部署${NC}"
  fi
  return 0
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  validate_deploy_env "$ROOT_DIR"
  exit $?
fi
