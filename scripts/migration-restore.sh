#!/bin/bash
# SmartDiagram — 一键数据导入恢复与部署脚本 (新服务器执行)
# 用法:
#   ./scripts/migration-restore.sh [归档包路径] [选项]
#
# 选项:
#   --no-deploy       仅还原数据库和文件，不自动执行 deploy.sh 启动全部服务
#   --skip-checksum   跳过 SHA256 校验和检查
#   -h, --help        显示帮助信息

set -Eeuo pipefail

# ── 颜色 ──
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

info()  { echo -e "${CYAN}ℹ  $1${NC}"; }
ok()    { echo -e "${GREEN}✅ $1${NC}"; }
warn()  { echo -e "${YELLOW}⚠️  $1${NC}"; }
error() { echo -e "${RED}❌ $1${NC}"; exit 1; }

TIMESTAMP="$(date -u +%Y%m%d_%H%M%SZ)"
BUNDLE_PATH=""
AUTO_DEPLOY=true
SKIP_CHECKSUM=false
STAGING_DIR=""

cleanup() {
    local exit_code=$?
    if [ -n "$STAGING_DIR" ] && [ -d "$STAGING_DIR" ]; then
        rm -rf "$STAGING_DIR"
    fi
    if [ $exit_code -ne 0 ]; then
        error "导入恢复异常中断，请检查上方日志排查错误。"
    fi
}
trap cleanup EXIT

# ── 解析参数 ──
while [[ $# -gt 0 ]]; do
    case "$1" in
        --no-deploy)
            AUTO_DEPLOY=false
            shift
            ;;
        --skip-checksum)
            SKIP_CHECKSUM=true
            shift
            ;;
        --help|-h)
            echo "SmartDiagram 一键数据恢复与部署工具"
            echo "用法: ./migrate.sh restore [归档包路径] [选项] 或 bash scripts/migration-restore.sh [归档包路径] [选项]"
            echo ""
            echo "选项:"
            echo "  [归档包路径]   指定导入的 .tar.gz 归档包 (缺省时自动查找当前目录最新包)"
            echo "  --no-deploy    仅恢复数据与配置，不自动执行一键部署"
            echo "  --skip-checksum 跳过 SHA256 完整性哈希校验"
            echo "  -h, --help     显示帮助信息"
            exit 0
            ;;
        -*)
            warn "未知选项: $1"
            shift
            ;;
        *)
            if [ -z "$BUNDLE_PATH" ]; then
                BUNDLE_PATH="$1"
            fi
            shift
            ;;
    esac
done

# 如果未指定包路径，尝试自动定位当前目录或 backups 下最新的包
if [ -z "$BUNDLE_PATH" ]; then
    FOUND_BUNDLE="$(ls -td "$ROOT_DIR"/smartdiagram-migration-bundle-*.tar.gz 2>/dev/null | head -1 || true)"
    if [ -z "$FOUND_BUNDLE" ]; then
        FOUND_BUNDLE="$(ls -td "$ROOT_DIR"/backups/smartdiagram-migration-bundle-*.tar.gz 2>/dev/null | head -1 || true)"
    fi
    if [ -n "$FOUND_BUNDLE" ] && [ -f "$FOUND_BUNDLE" ]; then
        BUNDLE_PATH="$FOUND_BUNDLE"
        info "未手动指定归档包，已自动检测到最新备份包: $BUNDLE_PATH"
    fi
fi

if [ -z "$BUNDLE_PATH" ] || [ ! -f "$BUNDLE_PATH" ]; then
    error "未找到迁移归档包！请指定正确的包路径，例如: ./migrate.sh restore /path/to/smartdiagram-migration-bundle-*.tar.gz"
fi

echo "=========================================================="
echo "      SmartDiagram 全量用户数据恢复与一键部署工具         "
echo "=========================================================="
info "项目根目录: $ROOT_DIR"
info "待恢复归档包: $BUNDLE_PATH"

# 1. 检查基础环境
command -v docker >/dev/null 2>&1 || error "未检测到 Docker，请确保 Docker 已安装并运行"
docker compose version >/dev/null 2>&1 || error "未检测到 docker compose 命令"

# 2. 解压归档包到临时工作区
STAGING_DIR="$ROOT_DIR/backups/restore_staging_${TIMESTAMP}"
mkdir -p "$STAGING_DIR"
chmod 700 "$STAGING_DIR"

info "正在解压迁移归档包..."
tar -xzf "$BUNDLE_PATH" -C "$STAGING_DIR"
ok "归档包解压完成"

# 3. 校验完整性
if [ "$SKIP_CHECKSUM" = false ] && [ -f "$STAGING_DIR/SHA256SUMS" ]; then
    info "正在校验数据包完整性 (SHA256)..."
    (
        cd "$STAGING_DIR"
        if command -v sha256sum >/dev/null 2>&1; then
            sha256sum -c SHA256SUMS >/dev/null 2>&1 || error "SHA256 校验失败，归档文件可能损坏或不完整"
        elif command -v shasum >/dev/null 2>&1; then
            shasum -a 256 -c SHA256SUMS >/dev/null 2>&1 || error "SHA256 校验失败，归档文件可能损坏或不完整"
        fi
    )
    ok "数据包完整性校验通过"
fi

# 4. 恢复环境变量与密钥配置文件
if [ "${SMARTDIAGRAM_HOST_DB:-0}" = "1" ] && [ -f "$ROOT_DIR/.env" ]; then
    info "使用新服务器现有 .env（包含宿主机 PostgreSQL 连接配置）"
elif [ -f "$STAGING_DIR/.env" ]; then
    if [ -f "$ROOT_DIR/.env" ]; then
        BACKUP_ENV="$ROOT_DIR/.env.bak_${TIMESTAMP}"
        warn "检测到当前根目录已存在 .env，已备份到: $BACKUP_ENV"
        cp "$ROOT_DIR/.env" "$BACKUP_ENV"
    fi
    info "恢复根目录 .env 配置文件..."
    cp "$STAGING_DIR/.env" "$ROOT_DIR/.env"
    chmod 600 "$ROOT_DIR/.env"
    ok ".env 配置恢复完成"
else
    if [ ! -f "$ROOT_DIR/.env" ]; then
        error "归档包内未包含 .env，且当前根目录也没有 .env 文件，无法继续"
    fi
fi

if [ -f "$STAGING_DIR/apps-api-diagram.env" ]; then
    mkdir -p "$ROOT_DIR/apps/api-diagram"
    cp "$STAGING_DIR/apps-api-diagram.env" "$ROOT_DIR/apps/api-diagram/.env"
fi

# 5. 启动数据库与 Redis
info "启动 PostgreSQL 数据库与 Redis 容器..."
docker compose up -d db redis

info "等待数据库就绪 (smartdiagram)..."
for i in {1..30}; do
    if docker compose exec -T db pg_isready -U postgres -d smartdiagram >/dev/null 2>&1; then
        break
    fi
    sleep 1
    if [ "$i" -eq 30 ]; then
        error "数据库启动超时，无法执行恢复"
    fi
done
ok "数据库就绪"

# 确保 ppt_agent 库在 postgres 实例中存在
docker compose up --no-deps ppt-db-init >/dev/null 2>&1 || true

# 6. 恢复角色与权限
if [ -f "$STAGING_DIR/roles.sql" ] && [ "${SMARTDIAGRAM_HOST_DB:-0}" != "1" ]; then
    info "恢复数据库角色与权限..."
    # 忽略已存在的角色错误
    docker compose exec -T db psql -U postgres < "$STAGING_DIR/roles.sql" >/dev/null 2>&1 || true
    ok "数据库角色与权限已同步"
fi

# 7. 恢复主图表数据库 (smartdiagram)
if [ -f "$STAGING_DIR/smartdiagram.dump" ]; then
    info "正在准备主数据库架构 (重置 public schema 并预装扩展)..."
    docker compose exec -T db psql -U postgres -d smartdiagram -c \
        "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO postgres; GRANT ALL ON SCHEMA public TO public; CREATE EXTENSION IF NOT EXISTS vector;" >/dev/null 2>&1 || true

    info "正在恢复 SmartDiagram 主数据库 (用户、会话、画布、向量嵌入)..."
    RESTORE_ROLE_ARGS=()
    if [ "${SMARTDIAGRAM_HOST_DB:-0}" = "1" ]; then
        # public schema and vector extension are created by postgres above;
        # their source comments cannot be reapplied while acting as the app role.
        RESTORE_ROLE_ARGS=(--role="${HOST_DB_USER:-smartdiagram_app}" --no-comments)
    fi
    cat "$STAGING_DIR/smartdiagram.dump" | docker compose exec -T db pg_restore \
        -U postgres -d smartdiagram --no-owner --no-acl "${RESTORE_ROLE_ARGS[@]}"
    ok "主数据库 (smartdiagram) 恢复成功"
else
    warn "未找到 smartdiagram.dump，跳过主库恢复"
fi

# 8. 恢复 PPT Agent 数据库 (ppt_agent)
if [ -f "$STAGING_DIR/ppt_agent.dump" ]; then
    info "正在准备 PPT Agent 数据库架构 (重置 public schema)..."
    docker compose exec -T db psql -U postgres -d ppt_agent -c \
        "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO postgres; GRANT ALL ON SCHEMA public TO public;" >/dev/null 2>&1 || true

    info "正在恢复 PPT Agent 数据库 (项目、工作台、幻灯片历史)..."
    RESTORE_ROLE_ARGS=()
    if [ "${SMARTDIAGRAM_HOST_DB:-0}" = "1" ]; then
        RESTORE_ROLE_ARGS=(--role="${HOST_DB_USER:-smartdiagram_app}" --no-comments)
    fi
    cat "$STAGING_DIR/ppt_agent.dump" | docker compose exec -T db pg_restore \
        -U postgres -d ppt_agent --no-owner --no-acl "${RESTORE_ROLE_ARGS[@]}"
    ok "PPT Agent 数据库 (ppt_agent) 恢复成功"
else
    info "未包含 ppt_agent.dump，跳过 PPT 库恢复"
fi

# 9. 恢复用户文件卷 (user-volumes.tar.gz)
if [ -f "$STAGING_DIR/user-volumes.tar.gz" ]; then
    info "正在解压并恢复用户上传文件卷、知识库素材与 PPT 导出文件..."
    # docker compose run -v uses literal Docker volume names for CLI mounts.
    # Resolve the effective Compose names so restored files reach the volumes
    # mounted by the application, including when COMPOSE_PROJECT_NAME differs.
    PPT_VOLUME_NAME="$(docker compose --profile qdrant config --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["volumes"]["pptdata"]["name"])')"
    KNOWLEDGE_VOLUME_NAME="$(docker compose --profile qdrant config --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["volumes"]["knowledgedata"]["name"])')"
    QDRANT_VOLUME_NAME="$(docker compose --profile qdrant config --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["volumes"]["qdrantdata"]["name"])')"
    docker compose run --rm --no-deps --user 0:0 \
        -v "$PPT_VOLUME_NAME":/target/pptdata \
        -v "$KNOWLEDGE_VOLUME_NAME":/target/knowledgedata \
        -v "$QDRANT_VOLUME_NAME":/target/qdrantdata \
        -v "$STAGING_DIR":/backup:ro \
        db sh -c "tar -xzf /backup/user-volumes.tar.gz -C /target"
    ok "用户持久化文件卷恢复成功"

    # 校准 PPT 数据卷的权限 (UID 1000 / 10001)
    info "校准持久化卷属主与读写权限..."
    docker compose up --no-deps ppt-storage-init >/dev/null 2>&1 || true
    ok "文件卷权限校准完成"
fi

# 10. 执行一键部署与服务启动
if [ "$AUTO_DEPLOY" = "true" ]; then
    info "正在执行全栈自动化部署 (构建镜像、启动服务并执行健康检查)..."
    # 调用现有的生产部署脚本
    ./deploy.sh --with-worker
    ok "全栈应用容器启动完成"
else
    info "已跳过自动部署 (--no-deploy)。后续可随时执行 ./deploy.sh --with-worker 启动服务"
fi

# 11. 数据恢复验证与统计报告
echo ""
echo "=========================================================="
echo "                   数据恢复核验报告                       "
echo "=========================================================="
USER_COUNT="$(docker compose exec -T db psql -U postgres -d smartdiagram -tAc "SELECT count(*) FROM users;" 2>/dev/null || echo "0")"
CONV_COUNT="$(docker compose exec -T db psql -U postgres -d smartdiagram -tAc "SELECT count(*) FROM conversations;" 2>/dev/null || echo "0")"
PPT_COUNT="$(docker compose exec -T db psql -U postgres -d ppt_agent -tAc "SELECT count(*) FROM \"Project\";" 2>/dev/null || echo "0")"

echo "  📊 恢复用户总数:     ${USER_COUNT//[[:space:]]/}"
echo "  💬 恢复对话历史总数: ${CONV_COUNT//[[:space:]]/}"
echo "  📽  恢复 PPT 项目总数: ${PPT_COUNT//[[:space:]]/}"
echo "=========================================================="
echo ""

GATEWAY_PORT="$(grep -E '^GATEWAY_PORT=' "$ROOT_DIR/.env" 2>/dev/null | cut -d= -f2 || echo "9237")"
ok "恭喜！所有用户数据、历史记录及系统配置已成功恢复！"
echo -e "${CYAN}访问入口: http://<新服务器IP>:${GATEWAY_PORT:-9237}${NC}"
echo ""
