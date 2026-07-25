#!/usr/bin/env bash
# 首次部署时自动生成 DB 密码与 Auth 密钥，并同步双库连接串（不覆盖已有 PostgreSQL 卷对应的密码）。

generate_deploy_hex_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
    return 0
  fi
  if [ -r /dev/urandom ] && command -v od >/dev/null 2>&1; then
    od -An -N32 -tx1 /dev/urandom | tr -d '[:space:]'
    return 0
  fi
  echo "缺少 openssl，无法自动生成部署密钥" >&2
  return 1
}

strip_env_quotes() {
  local value="$1"
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  printf '%s' "$value"
}

env_file_get() {
  local file="$1"
  local key="$2"
  local line value=""
  [ -f "$file" ] || return 1
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      "${key}"=*) value="${line#*=}" ;;
    esac
  done <"$file"
  strip_env_quotes "$value"
}

env_file_set() {
  local env_file="$1"
  local key="$2"
  local value="$3"
  local env_dir temp_file line seen=false

  if [ -L "$env_file" ]; then
    echo "拒绝通过符号链接写入: $env_file" >&2
    return 1
  fi
  env_dir="$(dirname "$env_file")"
  mkdir -p "$env_dir" 2>/dev/null || true
  umask 077
  temp_file="$(mktemp "${env_file}.tmp.XXXXXX")" || return 1

  if [ -f "$env_file" ]; then
    while IFS= read -r line || [ -n "$line" ]; do
      if [[ "$line" =~ ^[[:space:]]*${key}[[:space:]]*= ]]; then
        if [ "$seen" = false ]; then
          printf '%s=%s\n' "$key" "$value" >>"$temp_file"
          seen=true
        fi
        continue
      fi
      printf '%s\n' "$line" >>"$temp_file"
    done <"$env_file"
  fi
  if [ "$seen" = false ]; then
    printf '%s=%s\n' "$key" "$value" >>"$temp_file"
  fi
  chmod 600 "$temp_file" || { rm -f "$temp_file"; return 1; }
  mv "$temp_file" "$env_file"
}

is_default_db_password() {
  case "$1" in
    ""|"smartdiagram_secret"|"change-me"|"changeme") return 0 ;;
    *) return 1 ;;
  esac
}

is_placeholder_auth_secret() {
  case "$1" in
    ""|"smartdiagram-dev-session-secret-change-me"|"smartdiagram-dev-altcha-hmac-key-change-me"|"change-me") return 0 ;;
    *) return 1 ;;
  esac
}

postgres_data_volume_initialized() {
  local vol_name
  if ! command -v docker >/dev/null 2>&1; then
    return 1
  fi
  vol_name="$(docker volume ls --format '{{.Name}}' 2>/dev/null | grep -E '(^|_)pgdata$' | head -n 1 || true)"
  [ -n "$vol_name" ] || return 1
  docker run --rm -v "${vol_name}:/data:ro" alpine test -f /data/PG_VERSION >/dev/null 2>&1
}

replace_pg_url_password() {
  local url="$1"
  local new_password="$2"
  if [[ "$url" =~ ^(postgresql(\+asyncpg)?://postgres:)[^@]*(@.*)$ ]]; then
    printf '%s%s%s' "${BASH_REMATCH[1]}" "$new_password" "${BASH_REMATCH[3]}"
    return 0
  fi
  printf '%s' "$url"
}

sync_database_urls_for_password() {
  local env_file="$1"
  local password="$2"
  local diagram_url ppt_url ppt_url_alt new_diagram new_ppt new_ppt_alt

  diagram_url="$(env_file_get "$env_file" "DIAGRAM_DATABASE_URL")"
  ppt_url="$(env_file_get "$env_file" "DATABASE_URL")"
  ppt_url_alt="$(env_file_get "$env_file" "PPT_DATABASE_URL")"

  new_diagram="$(replace_pg_url_password "$diagram_url" "$password")"
  new_ppt="$(replace_pg_url_password "$ppt_url" "$password")"
  new_ppt_alt="$(replace_pg_url_password "$ppt_url_alt" "$password")"

  env_file_set "$env_file" "DB_PASSWORD" "$password"
  [ -n "$diagram_url" ] && env_file_set "$env_file" "DIAGRAM_DATABASE_URL" "$new_diagram"
  [ -n "$ppt_url" ] && env_file_set "$env_file" "DATABASE_URL" "$new_ppt"
  [ -n "$ppt_url_alt" ] && env_file_set "$env_file" "PPT_DATABASE_URL" "$new_ppt_alt"
}

ensure_deploy_database_password() {
  local env_file="${1:-.env}"
  local current new_password

  current="$(env_file_get "$env_file" "DB_PASSWORD")"
  if postgres_data_volume_initialized; then
    DEPLOY_DB_BOOTSTRAP_STATUS="existing_volume"
    export DEPLOY_DB_BOOTSTRAP_STATUS
    return 0
  fi

  if ! is_default_db_password "$current"; then
    DEPLOY_DB_BOOTSTRAP_STATUS="custom"
    export DEPLOY_DB_BOOTSTRAP_STATUS
    return 0
  fi

  new_password="$(generate_deploy_hex_secret)" || return 1
  sync_database_urls_for_password "$env_file" "$new_password"
  DEPLOY_DB_BOOTSTRAP_STATUS="generated"
  export DEPLOY_DB_BOOTSTRAP_STATUS
}

ensure_deploy_auth_secrets() {
  local env_file="${1:-.env}"
  local session altcha generated

  session="$(env_file_get "$env_file" "AUTH_SESSION_SECRET")"
  if is_placeholder_auth_secret "$session"; then
    generated="$(generate_deploy_hex_secret)" || return 1
    env_file_set "$env_file" "AUTH_SESSION_SECRET" "$generated"
    DEPLOY_AUTH_SESSION_BOOTSTRAP="generated"
  else
    DEPLOY_AUTH_SESSION_BOOTSTRAP="existing"
  fi

  altcha="$(env_file_get "$env_file" "ALTCHA_HMAC_KEY")"
  if is_placeholder_auth_secret "$altcha"; then
    generated="$(generate_deploy_hex_secret)" || return 1
    env_file_set "$env_file" "ALTCHA_HMAC_KEY" "$generated"
    DEPLOY_ALTCHA_BOOTSTRAP="generated"
  else
    DEPLOY_ALTCHA_BOOTSTRAP="existing"
  fi

  export DEPLOY_AUTH_SESSION_BOOTSTRAP DEPLOY_ALTCHA_BOOTSTRAP
}

bootstrap_deploy_secrets() {
  local env_file="${1:-.env}"
  # shellcheck source=scripts/ensure-deploy-secret.sh
  source "$(dirname "${BASH_SOURCE[0]}")/ensure-deploy-secret.sh"
  ensure_ppt_internal_api_secret "$env_file" || return 1
  ensure_deploy_database_password "$env_file" || return 1
  ensure_deploy_auth_secrets "$env_file" || return 1
  chmod 600 "$env_file" 2>/dev/null || true
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  set -Eeuo pipefail
  bootstrap_deploy_secrets "${1:-.env}"
fi
