#!/bin/bash
# SmartDiagram — 一键数据导出与打包脚本 (老服务器执行)
# 用法:
#   ./scripts/migration-export.sh [选项]
#
# 选项:
#   --output <path>   指定导出压缩包路径 (默认: smartdiagram-migration-bundle-<UTC时间戳>.tar.gz)
#   --low-mem         强制低内存保护模式 (临时停止重型应用容器，避免 OOM 崩溃)
#   --keep-stopped    导出后保持应用容器停止状态 (适合老服务器下线前最后一次导出)
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
OUTPUT_BUNDLE=""
LOW_MEM_MODE="auto"
KEEP_STOPPED=false
STAGING_DIR=""
STOPPED_APPS=()

cleanup() {
    local exit_code=$?
    if [ -n "$STAGING_DIR" ] && [ -d "$STAGING_DIR" ]; then
        rm -rf "$STAGING_DIR"
    fi
    if [ "$KEEP_STOPPED" = false ] && [ "${#STOPPED_APPS[@]}" -gt 0 ]; then
        info "正在恢复之前临时停止的应用容器..."
        docker compose up -d "${STOPPED_APPS[@]}" >/dev/null 2>&1 || true
    fi
    if [ $exit_code -ne 0 ]; then
        error "导出过程异常中断，临时文件已清理。"
    fi
}
trap cleanup EXIT

# ── 解析参数 ──
while [[ $# -gt 0 ]]; do
    case "$1" in
        --output|-o)
            OUTPUT_BUNDLE="$2"
            shift 2
            ;;
        --low-mem)
            LOW_MEM_MODE="true"
            shift
            ;;
        --keep-stopped)
            KEEP_STOPPED=true
            shift
            ;;
        --help|-h)
            echo "SmartDiagram 一键数据导出工具"
            echo "用法: ./migrate.sh export [选项] 或 bash scripts/migration-export.sh [选项]"
            echo ""
            echo "选项:"
            echo "  --output <文件路径>  指定打包输出的目标文件路径"
            echo "  --low-mem           强制低内存模式 (先停用耗内存容器，仅留数据库导出，防止OOM)"
            echo "  --keep-stopped      导出完成后保持应用容器停止 (适合迁移下线老服务器)"
            echo "  -h, --help          显示帮助信息"
            exit 0
            ;;
        *)
            warn "未知参数: $1"
            shift
            ;;
    esac
done

if [ -z "$OUTPUT_BUNDLE" ]; then
    OUTPUT_BUNDLE="$ROOT_DIR/smartdiagram-migration-bundle-${TIMESTAMP}.tar.gz"
fi

echo "=========================================================="
echo "      SmartDiagram 全量用户数据与配置一键导出工具         "
echo "=========================================================="
info "项目根目录: $ROOT_DIR"
info "目标归档包: $OUTPUT_BUNDLE"

# 1. 检查 Docker 环境
command -v docker >/dev/null 2>&1 || error "未检测到 Docker，请确保 Docker 已安装并运行"
docker compose version >/dev/null 2>&1 || error "未检测到 docker compose 命令"

# 2. 内存状态检测与防 OOM 处理
AVAILABLE_MEM_MB=9999
if [ -f /proc/meminfo ]; then
    AVAILABLE_MEM_MB="$(awk '/MemAvailable/ { print int($2/1024) }' /proc/meminfo 2>/dev/null || echo 9999)"
elif command -v vm_stat >/dev/null 2>&1; then
    # macOS 调试环境
    AVAILABLE_MEM_MB=4096
fi

info "当前可用物理内存: ${AVAILABLE_MEM_MB} MB"
if [ "$LOW_MEM_MODE" = "true" ] || [ "$AVAILABLE_MEM_MB" -lt 700 ]; then
    warn "检测到可用内存较低 (或已开启 --low-mem)，启动防 OOM 保护机制..."
    RUNNING_SERVICES="$(docker compose ps --services --status running 2>/dev/null || true)"
    CANDIDATES=("web" "gateway" "api-diagram" "ppt-python-api" "ppt-node-api" "worker")
    for s in "${CANDIDATES[@]}"; do
        if echo "$RUNNING_SERVICES" | grep -qx "$s"; then
            STOPPED_APPS+=("$s")
        fi
    done

    if [ "${#STOPPED_APPS[@]}" -gt 0 ]; then
        info "正在临时停止高耗内存容器以确保安全备份: ${STOPPED_APPS[*]}"
        docker compose stop "${STOPPED_APPS[@]}"
    fi
fi

# 3. 准备临时工作区
STAGING_DIR="$ROOT_DIR/backups/export_staging_${TIMESTAMP}"
mkdir -p "$STAGING_DIR"
chmod 700 "$STAGING_DIR"

# 4. 确保数据库基础设施运行并就绪
info "检查并确保数据库运行..."
docker compose up -d db redis
info "等待数据库就绪 (smartdiagram)..."
for i in {1..30}; do
    if docker compose exec -T db pg_isready -U postgres -d smartdiagram >/dev/null 2>&1; then
        break
    fi
    sleep 1
    if [ "$i" -eq 30 ]; then
        error "数据库启动超时，无法执行导出"
    fi
done

# 确保 ppt_agent 库存在
docker compose up --no-deps ppt-db-init >/dev/null 2>&1 || true

# 5. 导出主图表数据库 (smartdiagram)
info "正在导出 SmartDiagram 主数据库 (用户、会话、画布、向量嵌入)..."
docker compose exec -T db pg_dump -U postgres -d smartdiagram \
    --format=custom --no-owner --no-acl > "$STAGING_DIR/smartdiagram.dump"
test -s "$STAGING_DIR/smartdiagram.dump" || error "主数据库导出失败或文件为空"
ok "主数据库导出成功: $(du -h "$STAGING_DIR/smartdiagram.dump" | cut -f1)"

# 6. 导出 PPT Agent 数据库 (ppt_agent)
PPT_EXISTS="$(docker compose exec -T db psql -U postgres -d postgres -tAc \
    "SELECT 1 FROM pg_database WHERE datname = 'ppt_agent'" 2>/dev/null | tr -d '[:space:]' || true)"
if [ "$PPT_EXISTS" = "1" ]; then
    info "正在导出 PPT Agent 数据库 (项目、工作台、幻灯片版本)..."
    docker compose exec -T db pg_dump -U postgres -d ppt_agent \
        --format=custom --no-owner --no-acl > "$STAGING_DIR/ppt_agent.dump"
    test -s "$STAGING_DIR/ppt_agent.dump" || error "PPT 数据库导出失败或文件为空"
    ok "PPT 数据库导出成功: $(du -h "$STAGING_DIR/ppt_agent.dump" | cut -f1)"
else
    warn "未检测到 ppt_agent 数据库，跳过 PPT 库导出"
fi

# 7. 导出角色与权限表
info "正在导出数据库角色与权限配置..."
docker compose exec -T db pg_dumpall -U postgres --roles-only > "$STAGING_DIR/roles.sql"
test -s "$STAGING_DIR/roles.sql" || error "数据库角色导出失败"
ok "角色权限导出成功"

# 8. 归档数据卷 (knowledgedata, pptdata, qdrantdata)
info "正在归档用户上传素材、知识库与 PPT 文件卷 (user-volumes.tar.gz)..."
BACKUP_DIR="$STAGING_DIR" docker compose --profile tools run --rm --no-deps backup-volumes
test -s "$STAGING_DIR/user-volumes.tar.gz" || error "用户数据卷归档失败"
ok "数据卷归档成功: $(du -h "$STAGING_DIR/user-volumes.tar.gz" | cut -f1)"

# 9. 备份根目录 .env 及相关配置
if [ -f "$ROOT_DIR/.env" ]; then
    info "正在备份根目录 .env 环境配置文件..."
    cp "$ROOT_DIR/.env" "$STAGING_DIR/.env"
    ok ".env 配置已打包"
else
    warn "未找到根目录 .env 文件，请确保新服务器手动配置密钥！"
fi

if [ -f "$ROOT_DIR/apps/api-diagram/.env" ]; then
    cp "$ROOT_DIR/apps/api-diagram/.env" "$STAGING_DIR/apps-api-diagram.env"
fi

# 10. 生成版本清单与哈希校验和
info "正在计算校验和与清单..."
GIT_REV="unknown"
if [ -d "$ROOT_DIR/.git" ]; then
    GIT_REV="$(git rev-parse HEAD 2>/dev/null || echo "unknown")"
fi

cat <<EOF > "$STAGING_DIR/MANIFEST.txt"
migration_version=1.0
created_at_utc=${TIMESTAMP}
git_revision=${GIT_REV}
type=smartdiagram_full_migration_bundle
EOF

(
    cd "$STAGING_DIR"
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum ./* > SHA256SUMS 2>/dev/null || true
    elif command -v shasum >/dev/null 2>&1; then
        shasum -a 256 ./* > SHA256SUMS 2>/dev/null || true
    fi
)

# 11. 打包成单一迁移归档文件
info "正在封装为单一迁移归档包..."
mkdir -p "$(dirname "$OUTPUT_BUNDLE")"
tar -C "$STAGING_DIR" -czf "$OUTPUT_BUNDLE" .
test -s "$OUTPUT_BUNDLE" || error "生成迁移归档包失败"

BUNDLE_SIZE="$(du -h "$OUTPUT_BUNDLE" | cut -f1)"
echo ""
echo "=========================================================="
ok "全量数据与配置打包成功！"
echo "  归档文件: $OUTPUT_BUNDLE"
echo "  文件大小: $BUNDLE_SIZE"
echo "=========================================================="
echo ""
info "【下一步：传输到新服务器】"
echo "您可以在老服务器上直接使用 scp 命令发送到新服务器，例如："
echo -e "${GREEN}  scp \"$OUTPUT_BUNDLE\" root@<新服务器IP>:/root/${NC}"
echo ""
info "【在新服务器上恢复部署】"
echo "在新服务器拉取代码后，只需执行一条指令："
echo -e "${GREEN}  ./migrate.sh restore /root/$(basename "$OUTPUT_BUNDLE")${NC}"
echo ""
