#!/bin/bash
# SmartDiagram — 服务器一键部署脚本
# 用法: ./deploy.sh [选项]
#
# 选项:
#   --update      拉取代码、备份、迁移并更新服务（推荐）
#   --backup      仅备份数据库和用户文件
#   --pull        仅拉取最新代码，不部署
#   --check-mirror 检查宝塔/Docker 镜像加速是否可用
#   --rebuild     强制重建所有镜像
#   --with-worker 同时启动异步 worker
#   --with-qdrant 同时启动 Qdrant 向量数据库
#   --down        停止所有服务
#   --logs        查看实时日志
#   --status      查看服务状态
#   --cn          强制启用中国大陆加速
#   --no-cn       强制禁用中国大陆加速

set -Eeuo pipefail

ORIGINAL_ARGS=("$@")

# ── 颜色 ──
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

BACKUP_ROOT="${BACKUP_ROOT:-$ROOT_DIR/backups}"
LAST_BACKUP_DIR=""
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
PROFILE_ARGS=()
PAUSED_SERVICES=()
LEGACY_STORAGE_FILE_COUNT=0

# ── 辅助函数 ──
info()  { echo -e "${CYAN}ℹ  $1${NC}"; }
ok()    { echo -e "${GREEN}✅ $1${NC}"; }
warn()  { echo -e "${YELLOW}⚠️  $1${NC}"; }
error() { echo -e "${RED}❌ $1${NC}"; exit 1; }

on_error() {
    local line="$1"
    resume_writers
    warn "部署在第 ${line} 行中断；数据库卷和用户文件卷均未删除。"
    if [ -n "$LAST_BACKUP_DIR" ]; then
        warn "本次部署前备份保存在: $LAST_BACKUP_DIR"
    fi
}
trap 'on_error "$LINENO"' ERR

# ── 检测中国大陆网络 ──
# 通过尝试访问 google.com 判断（超时 3 秒），不通则认为是大陆网络
CN_MIRROR="auto"
detect_cn() {
    if [ "$CN_MIRROR" = "true" ]; then
        ok "中国大陆加速: 已手动启用 (--cn)"
        return
    fi
    if [ "$CN_MIRROR" = "false" ]; then
        ok "中国大陆加速: 已手动禁用 (--no-cn)"
        return
    fi
    # 自动检测
    info "检测网络环境..."
    if curl -s --connect-timeout 3 https://www.google.com > /dev/null 2>&1; then
        CN_MIRROR="false"
        ok "网络环境: 国际网络，使用默认源"
    else
        CN_MIRROR="true"
        ok "网络环境: 中国大陆，自动启用镜像加速"
    fi
}

dotenv_value() {
    local key="$1"
    local value=""
    if [ -f .env ]; then
        value="$(sed -n "s/^${key}=//p" .env | tail -n 1)"
        value="${value%\"}"
        value="${value#\"}"
        value="${value%\'}"
        value="${value#\'}"
    fi
    echo "$value"
}

configure_build_image_sources() {
    local configured_uv configured_uv_python
    configured_uv="${UV_IMAGE:-$(dotenv_value UV_IMAGE)}"
    configured_uv_python="${UV_PYTHON_IMAGE:-$(dotenv_value UV_PYTHON_IMAGE)}"

    if [ "$CN_MIRROR" = "true" ]; then
        UV_IMAGE="${configured_uv:-ghcr.1ms.run/astral-sh/uv:0.10.5}"
        UV_PYTHON_IMAGE="${configured_uv_python:-ghcr.1ms.run/astral-sh/uv:python3.13-bookworm-slim}"
    else
        UV_IMAGE="${configured_uv:-ghcr.io/astral-sh/uv:0.10.5}"
        UV_PYTHON_IMAGE="${configured_uv_python:-ghcr.io/astral-sh/uv:python3.13-bookworm-slim}"
    fi

    export UV_IMAGE UV_PYTHON_IMAGE
    info "UV 工具镜像: $UV_IMAGE"
    info "Python 构建镜像: $UV_PYTHON_IMAGE"
}

# ── 检查 Docker 镜像加速 ──
# 宝塔会管理 /etc/docker/daemon.json；项目只读检查，绝不覆盖面板配置。
check_docker_mirror() {
    local mirrors panel_hint
    mirrors="$(docker info --format '{{range .RegistryConfig.Mirrors}}{{println .}}{{end}}' 2>/dev/null || true)"
    panel_hint="宝塔面板 → Docker → 设置 → 修改加速 URL → https://docker.1ms.run → 保存并重启 Docker"

    if [ -n "$mirrors" ]; then
        info "Docker 当前镜像加速器: $(echo "$mirrors" | tr '\n' ' ')"
    elif [ "$CN_MIRROR" = "true" ]; then
        warn "国内网络未检测到 Docker registry mirror"
        if [ -d /www/server/panel ]; then
            warn "$panel_hint"
        fi
        error "请先配置国内 Docker 镜像加速并重启 Docker"
    fi

    if [ "$CN_MIRROR" = "true" ]; then
        if [ -d /www/server/panel ] && ! echo "$mirrors" | grep -q 'docker\.1ms\.run'; then
            warn "检测到宝塔面板，但当前不是宝塔近期推荐的合作加速节点"
            warn "$panel_hint"
        fi

        # 使用极小的公共镜像做真实 pull，避免等到备份和大镜像构建后才发现网络失败。
        info "验证 Docker Hub 镜像加速链路..."
        if ! docker pull hello-world:latest >/dev/null 2>&1; then
            warn "当前 registry mirror 无法完成 Docker Hub 拉取"
            if [ -d /www/server/panel ]; then
                warn "$panel_hint"
            fi
            error "Docker 镜像加速验证失败，尚未备份、迁移或替换业务容器"
        fi
        ok "Docker Hub 镜像加速链路可用"
    fi

    # GHCR 不使用 Docker Hub registry-mirrors，国内必须显式切换 ghcr.1ms.run。
    # 这两个镜像是后续构建的真实依赖；提前拉取可缓存镜像并避免备份后才超时。
    info "验证 GHCR UV 工具镜像..."
    if ! docker pull "$UV_IMAGE"; then
        error "UV 工具镜像拉取失败: $UV_IMAGE（尚未备份、迁移或替换业务容器）"
    fi

    info "验证 GHCR Python 构建镜像..."
    if ! docker pull "$UV_PYTHON_IMAGE"; then
        error "Python 构建镜像拉取失败: $UV_PYTHON_IMAGE（尚未备份、迁移或替换业务容器）"
    fi
    ok "Docker Hub 与 GHCR 镜像链路均可用"
}

# ── 检查 Docker ──
check_docker() {
    if ! command -v docker &>/dev/null; then
        error "未安装 Docker，请先安装: https://docs.docker.com/engine/install/"
    fi
    if ! docker compose version &>/dev/null; then
        error "未安装 Docker Compose V2，请升级 Docker"
    fi
    if ! docker info &>/dev/null; then
        error "Docker daemon 未运行或当前用户无访问权限，请先启动 Docker 并检查 docker 用户组权限"
    fi
    if ! command -v curl &>/dev/null; then
        error "未安装 curl，无法执行部署后的健康检查"
    fi
    docker compose config --quiet
    ok "Docker 环境就绪"
}

# ── 部署前磁盘保护 ──
root_disk_usage_percent() {
    df -P / | awk 'NR == 2 { gsub(/%/, "", $5); print $5 }'
}

compose_project_name() {
    docker compose config --format json \
        | awk -F'"' 'project == "" && /^[[:space:]]*"name":/ { project = $4 } END { print project }'
}

prune_unused_images_when_disk_is_high() {
    local usage_percent project_name remaining_percent
    usage_percent="$(root_disk_usage_percent)"
    case "$usage_percent" in
        ''|*[!0-9]*) error "无法读取根分区磁盘使用率，已停止部署" ;;
    esac

    if [ "$usage_percent" -le 85 ]; then
        info "根分区使用率 ${usage_percent}%，无需清理未使用镜像"
        return
    fi

    project_name="$(compose_project_name)"
    [ -n "$project_name" ] \
        || error "无法识别当前 Compose 项目，已停止镜像清理和部署"

    warn "根分区使用率 ${usage_percent}% 超过 85%，清理 ${project_name} 项目的未使用历史镜像..."
    docker image prune -a -f --filter \
        "label=com.docker.compose.project=${project_name}"

    remaining_percent="$(root_disk_usage_percent)"
    ok "${project_name} 项目的未使用镜像清理完成，根分区使用率 ${remaining_percent}%"
}

# ── 检查 .env ──
check_env() {
    if [ ! -f "backend/.env" ]; then
        if [ -f "backend/.env.example" ]; then
            warn "未检测到 backend/.env，正在从 .env.example 复制..."
            cp backend/.env.example backend/.env
            warn "请编辑 backend/.env 填入 API Key 等配置后重新运行"
            exit 1
        else
            error "未找到 backend/.env 或 .env.example"
        fi
    fi

    # 检查关键配置
    if grep -q "sk-your-api-key" backend/.env; then
        warn "backend/.env 中的 OPENAI_API_KEY 尚未配置！"
        warn "请编辑 backend/.env 填入真实的 API Key"
        exit 1
    fi

    ok "环境变量配置就绪"
}

ensure_deploy_environment() {
    source "$ROOT_DIR/scripts/ensure-deploy-secret.sh"
    ensure_ppt_internal_api_secret "$ROOT_DIR/.env"
    case "${PPT_SECRET_BOOTSTRAP_STATUS:-}" in
        generated) ok "已生成 PPT 内部密钥并安全写入根目录 .env" ;;
        environment) ok "PPT 内部密钥已由外部环境提供" ;;
        *) ok "PPT 内部密钥已就绪" ;;
    esac
}

# ── 拉取代码 ──
pull_code() {
    if [ -d ".git" ]; then
        local before_revision after_revision
        if ! git diff --quiet || ! git diff --cached --quiet; then
            error "服务器工作区存在未提交修改，已停止更新以免覆盖。请先提交或备份这些修改"
        fi
        before_revision="$(git rev-parse HEAD)"
        info "拉取最新代码..."
        git pull --ff-only origin "$DEPLOY_BRANCH" || {
            warn "Git pull 失败，可能有本地修改。请手动处理后重试"
            exit 1
        }
        after_revision="$(git rev-parse HEAD)"
        ok "代码已更新到最新版本"

        if [ "$before_revision" != "$after_revision" ] && \
            ! git diff --quiet "$before_revision" "$after_revision" -- deploy.sh; then
            if [ "${SMARTDIAGRAM_DEPLOY_REEXECED:-false}" = "true" ]; then
                error "部署脚本连续自更新，已停止以避免重复执行"
            fi
            info "检测到部署脚本已更新，正在使用新版本继续..."
            SMARTDIAGRAM_DEPLOY_REEXECED=true exec "$ROOT_DIR/deploy.sh" "${ORIGINAL_ARGS[@]}"
        fi
    else
        warn "不是 Git 仓库，跳过代码拉取"
    fi
}

# ── 构建 profiles 参数 ──
prepare_profiles() {
    PROFILE_ARGS=()
    if [ "$WITH_WORKER" = true ]; then
        PROFILE_ARGS+=(--profile worker)
    fi
    if [ "$WITH_QDRANT" = true ]; then
        PROFILE_ARGS+=(--profile qdrant)
    fi
}

compose() {
    docker compose "${PROFILE_ARGS[@]}" "$@"
}

pause_writers() {
    local running service
    PAUSED_SERVICES=()
    running="$(docker compose --profile worker --profile qdrant ps --status running --services 2>/dev/null || true)"

    for service in backend worker ppt-node-api ppt-python-api qdrant; do
        if echo "$running" | grep -qx "$service"; then
            info "短暂停写以生成一致备份/迁移: $service"
            docker compose --profile worker --profile qdrant pause "$service"
            PAUSED_SERVICES+=("$service")
        fi
    done
}

resume_writers() {
    local service
    if [ "${#PAUSED_SERVICES[@]}" -eq 0 ]; then
        return
    fi
    for service in "${PAUSED_SERVICES[@]}"; do
        docker compose --profile worker --profile qdrant unpause "$service" >/dev/null 2>&1 || true
    done
    PAUSED_SERVICES=()
    ok "业务写入服务已恢复"
}

ensure_no_paused_services() {
    local paused service
    paused="$(docker compose --profile worker --profile qdrant ps --status paused --services 2>/dev/null || true)"
    if [ -z "$paused" ]; then
        return
    fi

    while IFS= read -r service; do
        [ -n "$service" ] || continue
        info "恢复仍处于暂停状态的 Compose 服务: $service"
        docker compose --profile worker --profile qdrant unpause "$service"
    done <<< "$paused"

    paused="$(docker compose --profile worker --profile qdrant ps --status paused --services 2>/dev/null || true)"
    if [ -n "$paused" ]; then
        error "仍有服务处于暂停状态，停止容器切换: $(echo "$paused" | tr '\n' ' ')"
    fi
}

wait_for_database() {
    info "等待 PostgreSQL 就绪..."
    local attempt
    for attempt in $(seq 1 60); do
        if compose exec -T db pg_isready -U postgres -d smartdiagram >/dev/null 2>&1; then
            ok "PostgreSQL 已就绪"
            return
        fi
        sleep 2
    done
    error "PostgreSQL 在 120 秒内未就绪"
}

detect_legacy_storage_layout() {
    local mounted file_count
    LEGACY_STORAGE_FILE_COUNT=0
    if ! docker container inspect smartdiagram-backend >/dev/null 2>&1; then
        return
    fi

    mounted="$(docker container inspect smartdiagram-backend \
        --format '{{range .Mounts}}{{if eq .Destination "/app/storage"}}mounted{{end}}{{end}}' 2>/dev/null || true)"
    if [ "$mounted" = "mounted" ]; then
        return
    fi

    file_count="$(docker exec smartdiagram-backend sh -c \
        'find /app/storage -type f 2>/dev/null | wc -l' 2>/dev/null | tr -d '[:space:]' || true)"
    case "$file_count" in
        ''|*[!0-9]*) file_count=0 ;;
    esac
    if [ "$file_count" -gt 0 ]; then
        warn "旧 backend 容器的 /app/storage 内检测到 ${file_count} 个文件，但该目录未挂载命名卷"
        LEGACY_STORAGE_FILE_COUNT="$file_count"
    fi
}

migrate_legacy_storage() {
    local backup_dir="$1"
    local legacy_dir copied_count
    if [ "$LEGACY_STORAGE_FILE_COUNT" -eq 0 ]; then
        return
    fi

    legacy_dir="$backup_dir/legacy-backend-storage"
    mkdir -p "$legacy_dir"
    info "从旧 backend 容器备份历史上传文件..."
    docker cp smartdiagram-backend:/app/storage/. "$legacy_dir/"
    copied_count="$(find "$legacy_dir" -type f | wc -l | tr -d '[:space:]')"
    if [ "$copied_count" -lt "$LEGACY_STORAGE_FILE_COUNT" ]; then
        error "旧容器文件备份不完整（检测 ${LEGACY_STORAGE_FILE_COUNT}，复制 ${copied_count}）"
    fi

    info "将历史上传文件导入持久化命名卷（仅允许空卷）..."
    LEGACY_STORAGE_SOURCE="$legacy_dir" \
        docker compose --profile tools run --rm --no-deps legacy-storage-import
    ok "历史上传文件已备份并迁移到 knowledgedata 命名卷"
}

prepare_databases() {
    info "启动数据库与 Redis（保留现有命名卷）..."
    compose up -d db redis
    wait_for_database

    # 只在不存在时创建 PPT 数据库；不会重建已有数据库。
    compose up --no-deps ppt-db-init
}

write_checksums() {
    local backup_dir="$1"
    if command -v sha256sum &>/dev/null; then
        (cd "$backup_dir" && sha256sum ./*.dump ./*.sql ./*.tar.gz MANIFEST.txt > SHA256SUMS)
    else
        (cd "$backup_dir" && shasum -a 256 ./*.dump ./*.sql ./*.tar.gz MANIFEST.txt > SHA256SUMS)
    fi
}

backup_data() {
    detect_legacy_storage_layout
    prepare_databases

    local timestamp backup_dir revision ppt_exists
    timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
    backup_dir="$BACKUP_ROOT/$timestamp"
    revision="unknown"
    if [ -d .git ]; then
        revision="$(git rev-parse HEAD)"
    fi

    umask 077
    mkdir -p "$backup_dir"
    chmod 700 "$backup_dir"
    LAST_BACKUP_DIR="$backup_dir"

    # 逻辑库和文件卷必须来自同一稳定时间点，避免上传过程中只备份到半个文件。
    pause_writers
    # 暂停后再复制容器层文件，保证文件数量和内容不在迁移过程中变化。
    # 导入工具拒绝覆盖非空目标卷。
    migrate_legacy_storage "$backup_dir"

    info "备份 SmartDiagram 主数据库..."
    compose exec -T db pg_dump -U postgres -d smartdiagram \
        --format=custom --no-owner --no-acl > "$backup_dir/smartdiagram.dump"
    test -s "$backup_dir/smartdiagram.dump"

    ppt_exists="$(compose exec -T db psql -U postgres -d postgres -tAc \
        "SELECT 1 FROM pg_database WHERE datname = 'ppt_agent'" | tr -d '[:space:]')"
    if [ "$ppt_exists" = "1" ]; then
        info "备份 PPT Agent 数据库..."
        compose exec -T db pg_dump -U postgres -d ppt_agent \
            --format=custom --no-owner --no-acl > "$backup_dir/ppt_agent.dump"
    else
        # 保持校验清单结构稳定；正常情况下 ppt-db-init 已创建该库。
        error "PPT Agent 数据库不存在，停止部署"
    fi
    test -s "$backup_dir/ppt_agent.dump"

    info "备份数据库角色和权限..."
    compose exec -T db pg_dumpall -U postgres --roles-only > "$backup_dir/roles.sql"
    test -s "$backup_dir/roles.sql"

    info "只读归档用户上传、知识库和 PPT 导出文件..."
    BACKUP_DIR="$backup_dir" docker compose --profile tools run --rm --no-deps backup-volumes
    test -s "$backup_dir/user-volumes.tar.gz"

    {
        echo "created_at_utc=$timestamp"
        echo "git_revision=$revision"
        echo "compose_project=$(docker compose ls --format json 2>/dev/null | tr -d '\n')"
        echo "contains=smartdiagram.dump,ppt_agent.dump,roles.sql,user-volumes.tar.gz"
        echo "legacy_storage_files_migrated=$LEGACY_STORAGE_FILE_COUNT"
        echo "policy=non_destructive_backup_before_migration"
    } > "$backup_dir/MANIFEST.txt"
    write_checksums "$backup_dir"
    resume_writers

    ok "完整备份已生成: $backup_dir"
}

audit_migrations() {
    local findings
    [ -d ppt-agent-engine/prisma/migrations ] || error "PPT 数据库迁移目录不存在"
    findings="$(grep -ERin --include='migration.sql' \
        '(^|[[:space:];])(DROP|TRUNCATE)([[:space:]]|$)|DELETE[[:space:]]+FROM' \
        ppt-agent-engine/prisma/migrations || true)"
    if [ -n "$findings" ]; then
        echo "$findings"
        error "检测到破坏性数据库语句，自动部署已停止；请人工审核并制定数据迁移方案"
    fi
    ok "迁移安全检查通过（未发现 DROP、TRUNCATE、DELETE FROM）"
}

migrate_databases() {
    audit_migrations

    info "执行 SmartDiagram 主数据库增量初始化..."
    compose run --rm --no-deps backend python scripts/migrate_database.py

    info "执行 PPT Agent 事务型增量迁移..."
    compose run --rm --no-deps ppt-node-api ./node_modules/.bin/tsx prisma/apply-migrations.ts

    ok "数据库迁移完成，既有表和用户数据均保留"
}

wait_for_url() {
    local name="$1"
    local url="$2"
    local attempt
    for attempt in $(seq 1 60); do
        if curl -fsS --max-time 5 "$url" >/dev/null 2>&1; then
            ok "$name 健康检查通过"
            return
        fi
        sleep 2
    done
    error "$name 健康检查失败: $url"
}

verify_deployment() {
    local gateway_port backend_port
    gateway_port="$(compose port gateway 80 | tail -n 1 | awk -F: '{print $NF}')"
    backend_port="$(compose port backend 8000 | tail -n 1 | awk -F: '{print $NF}')"
    test -n "$gateway_port"
    test -n "$backend_port"

    wait_for_url "SmartDiagram API" "http://127.0.0.1:${backend_port}/api/health"
    wait_for_url "统一网关" "http://127.0.0.1:${gateway_port}/nginx-health"
    wait_for_url "PPT Agent API" "http://127.0.0.1:${gateway_port}/ppt-api/api/health"
}

# ── 部署 ──
deploy() {
    check_docker
    prepare_profiles
    prune_unused_images_when_disk_is_high

    if [ "$UPDATE_CODE" = true ]; then
        pull_code
        # 新版本可能调整 Compose 或环境变量要求，拉取后重新验证。
        docker compose config --quiet
    fi

    check_env
    detect_cn
    configure_build_image_sources

    # 宝塔/宿主机负责配置 daemon；这里只读验证真实 pull 能否成功。
    check_docker_mirror

    # 导出 CN_MIRROR 供 docker-compose.yml 的 build args 读取
    export CN_MIRROR

    # 每次更新都先做逻辑数据库备份和用户文件卷只读归档。
    # 备份成功之前不会构建、迁移或替换任何业务容器。
    backup_data

    if [ "$FORCE_REBUILD" = true ]; then
        info "强制重建所有镜像..."
        compose build --no-cache
    else
        info "构建最新应用镜像..."
        compose build
    fi

    # 构建期间保持服务在线；迁移与容器切换期间短暂停写。
    pause_writers
    migrate_databases
    # Compose 无法直接重建 paused 容器；迁移完成后先恢复，再执行容器切换。
    resume_writers
    ensure_no_paused_services

    info "更新并启动所有服务（保留现有命名卷）..."
    compose up -d --remove-orphans

    verify_deployment

    # 构建可能再次推高磁盘使用率；收尾时仍只清理当前 Compose 项目。
    prune_unused_images_when_disk_is_high

    echo ""
    ok "部署完成！"
    echo ""
    echo -e "${CYAN}服务地址:${NC}"
    echo -e "  🌐 统一入口: http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo 'localhost'):${GATEWAY_PORT:-9237}"
    echo -e "  ⚙️  后端 API: http://localhost:9236/api/health"
    echo -e "  🐘 数据库:   postgresql://localhost:5432"
    echo -e "  📊 Draw.io:  http://localhost:9022"
    if [ "$WITH_QDRANT" = true ]; then
        echo -e "  🔍 Qdrant:   http://localhost:6333"
    fi
    echo ""
    echo -e "${CYAN}常用命令:${NC}"
    echo "  ./deploy.sh --update     拉取、备份、迁移并更新"
    echo "  ./deploy.sh --backup     仅备份数据库和用户文件"
    echo "  ./deploy.sh --logs       查看实时日志"
    echo "  ./deploy.sh --status     查看服务状态"
    echo "  ./deploy.sh --down       停止所有服务"
    echo "  ./deploy.sh --rebuild    强制重建并部署"
    echo "  ./deploy.sh --clean      深度清理 Docker 磁盘空间"
    echo ""
    echo -e "${CYAN}本次备份:${NC} $LAST_BACKUP_DIR"
}

# ── 停止 ──
stop_all() {
    info "停止所有服务..."
    prepare_profiles
    compose down
    ok "所有服务已停止；命名卷未删除，用户数据仍然保留"
}

# ── 日志 ──
show_logs() {
    prepare_profiles
    compose logs -f --tail=100
}

# ── 状态 ──
show_status() {
    echo -e "${CYAN}╔══════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║    SmartDiagram 服务状态             ║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════╝${NC}"
    echo ""
    prepare_profiles
    compose ps
}

backup_only() {
    check_docker
    prepare_profiles
    backup_data
    ok "备份完成；没有构建镜像、迁移数据库或重启业务服务"
}

check_mirror_only() {
    check_docker
    detect_cn
    configure_build_image_sources
    check_docker_mirror
}

# ── 深度清理 ──
deep_clean() {
    echo -e "${CYAN}╔══════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║    Docker 磁盘空间清理               ║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════╝${NC}"
    echo ""

    info "清理前磁盘使用:"
    docker system df
    echo ""

    info "清理悬空镜像 (dangling images)..."
    docker image prune -f

    info "清理超过 24 小时的构建缓存..."
    docker builder prune -f --filter "until=24h"

    info "清理已停止的容器..."
    docker container prune -f

    echo ""
    ok "清理完成！"
    info "清理后磁盘使用:"
    docker system df
    echo ""
    echo -e "${YELLOW}提示: 如需更激进清理（删除所有未使用镜像），运行:${NC}"
    echo "  docker system prune -a -f"
}

# ── 参数解析 ──
WITH_WORKER=false
WITH_QDRANT=false
FORCE_REBUILD=false
UPDATE_CODE=false
ACTION="deploy"

for arg in "$@"; do
    case $arg in
        --pull)
            pull_code
            exit 0
            ;;
        --update)
            UPDATE_CODE=true
            ;;
        --backup)
            ACTION="backup"
            ;;
        --check-mirror)
            ACTION="check_mirror"
            ;;
        --rebuild)
            FORCE_REBUILD=true
            ;;
        --with-worker)
            WITH_WORKER=true
            ;;
        --with-qdrant)
            WITH_QDRANT=true
            ;;
        --cn)
            CN_MIRROR="true"
            ;;
        --no-cn)
            CN_MIRROR="false"
            ;;
        --down)
            ACTION="stop"
            ;;
        --logs)
            ACTION="logs"
            ;;
        --status)
            ACTION="status"
            ;;
        --clean)
            ACTION="clean"
            ;;
        --help|-h)
            echo "用法: ./deploy.sh [选项]"
            echo ""
            echo "选项:"
            echo "  --update       拉取最新代码、完整备份、增量迁移并更新服务（推荐）"
            echo "  --backup       仅备份数据库和用户文件，不更新服务"
            echo "  --pull         仅拉取最新代码，不部署"
            echo "  --check-mirror 检查宝塔/Docker 镜像加速是否能够真实拉取"
            echo "  --rebuild      强制重建所有镜像"
            echo "  --with-worker  同时启动异步 worker"
            echo "  --with-qdrant  同时启动 Qdrant"
            echo "  --cn           强制启用中国大陆加速"
            echo "  --no-cn        强制禁用中国大陆加速"
            echo "  --down         停止所有服务"
            echo "  --logs         查看实时日志"
            echo "  --status       查看服务状态"
            echo "  --clean        深度清理 Docker 磁盘空间"
            echo ""
            echo "数据安全保证:"
            echo "  - 更新前自动备份 smartdiagram、ppt_agent 和所有用户文件卷"
            echo "  - 迁移发现 DROP/TRUNCATE/DELETE FROM 时立即中止"
            echo "  - 所有 down/clean 操作都不会删除 Docker 命名卷"
            exit 0
            ;;
        *)
            warn "未知参数: $arg"
            ;;
    esac
done

# Compose 会在执行任何子命令前校验必填变量，因此密钥必须
# 在 check_docker 和主动作分发之前就完成初始化。
case "$ACTION" in
    deploy|stop|logs|status|backup|check_mirror)
        ensure_deploy_environment
        ;;
esac

case $ACTION in
    deploy)  deploy     ;;
    stop)    stop_all   ;;
    logs)    show_logs  ;;
    status)  show_status ;;
    backup)  backup_only ;;
    check_mirror) check_mirror_only ;;
    clean)   deep_clean ;;
esac
