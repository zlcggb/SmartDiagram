#!/usr/bin/env bash

PPT_SECRET_KEY="PPT_INTERNAL_API_SECRET"

is_placeholder_ppt_secret() {
    case "$1" in
        ""|"replace-with-a-long-random-value"|"smartdiagram-ppt-internal-dev-change-me") return 0 ;;
        *) return 1 ;;
    esac
}

validate_ppt_secret_length() {
    local secret="$1"
    local LC_ALL=C
    if [ "${#secret}" -lt 32 ]; then
        echo "PPT_INTERNAL_API_SECRET 已配置但少于 32 字节，已停止部署" >&2
        return 1
    fi
}

strip_outer_quotes() {
    local value="$1"
    value="${value%\"}"
    value="${value#\"}"
    value="${value%\'}"
    value="${value#\'}"
    printf '%s' "$value"
}

read_ppt_secret_from_env_file() {
    local env_file="$1"
    local line value=""
    [ -f "$env_file" ] || return 0

    while IFS= read -r line || [ -n "$line" ]; do
        case "$line" in
            "$PPT_SECRET_KEY"=*) value="${line#*=}" ;;
        esac
    done < "$env_file"
    strip_outer_quotes "$value"
}

generate_ppt_internal_api_secret() {
    local generated
    if command -v openssl >/dev/null 2>&1; then
        generated="$(openssl rand -hex 32)"
    elif [ -r /dev/urandom ] && command -v od >/dev/null 2>&1; then
        generated="$(od -An -N32 -tx1 /dev/urandom | tr -d '[:space:]')"
    else
        echo "缺少 openssl 且无法读取 /dev/urandom，不能安全生成 PPT 内部密钥" >&2
        return 1
    fi

    if [[ ! "$generated" =~ ^[0-9a-f]{64}$ ]]; then
        echo "PPT 内部密钥生成结果无效，已停止部署" >&2
        return 1
    fi
    printf '%s' "$generated"
}

write_ppt_secret_to_env_file() {
    local env_file="$1"
    local secret="$2"
    local env_dir temp_file line seen=false

    if [ -L "$env_file" ]; then
        echo "拒绝通过符号链接写入部署环境文件: $env_file" >&2
        return 1
    fi
    env_dir="$(dirname "$env_file")"
    if [ ! -d "$env_dir" ]; then
        echo "部署环境文件所在目录不存在: $env_dir" >&2
        return 1
    fi

    umask 077
    temp_file="$(mktemp "${env_file}.tmp.XXXXXX")" || return 1

    if [ -f "$env_file" ]; then
        while IFS= read -r line || [ -n "$line" ]; do
            if [[ "$line" =~ ^[[:space:]]*PPT_INTERNAL_API_SECRET[[:space:]]*= ]]; then
                if [ "$seen" = false ]; then
                    printf '%s=%s\n' "$PPT_SECRET_KEY" "$secret" >> "$temp_file"
                    seen=true
                fi
                continue
            fi
            printf '%s\n' "$line" >> "$temp_file"
        done < "$env_file"
    fi
    if [ "$seen" = false ]; then
        printf '%s=%s\n' "$PPT_SECRET_KEY" "$secret" >> "$temp_file"
    fi

    if ! chmod 600 "$temp_file" || ! mv "$temp_file" "$env_file"; then
        rm -f "$temp_file"
        echo "无法安全写入部署环境文件: $env_file" >&2
        return 1
    fi
}

ensure_ppt_internal_api_secret() {
    local env_file="${1:-.env}"
    local external_secret file_secret generated_secret

    external_secret="${PPT_INTERNAL_API_SECRET:-}"
    if ! is_placeholder_ppt_secret "$external_secret"; then
        validate_ppt_secret_length "$external_secret" || return 1
        PPT_SECRET_BOOTSTRAP_STATUS="environment"
        export PPT_SECRET_BOOTSTRAP_STATUS
        return 0
    fi

    file_secret="$(read_ppt_secret_from_env_file "$env_file")"
    if ! is_placeholder_ppt_secret "$file_secret"; then
        validate_ppt_secret_length "$file_secret" || return 1
        chmod 600 "$env_file" || {
            echo "无法收紧部署环境文件权限: $env_file" >&2
            return 1
        }
        PPT_INTERNAL_API_SECRET="$file_secret"
        PPT_SECRET_BOOTSTRAP_STATUS="file"
        export PPT_INTERNAL_API_SECRET PPT_SECRET_BOOTSTRAP_STATUS
        return 0
    fi

    generated_secret="$(generate_ppt_internal_api_secret)" || return 1
    write_ppt_secret_to_env_file "$env_file" "$generated_secret" || return 1
    PPT_INTERNAL_API_SECRET="$generated_secret"
    PPT_SECRET_BOOTSTRAP_STATUS="generated"
    export PPT_INTERNAL_API_SECRET PPT_SECRET_BOOTSTRAP_STATUS
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
    set -Eeuo pipefail
    ensure_ppt_internal_api_secret "${1:-.env}"
fi
