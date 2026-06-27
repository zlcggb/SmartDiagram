#!/bin/bash
# SmartDiagram — 服务器一键部署脚本
# 用法: ./deploy.sh [选项]
#
# 选项:
#   --pull        仅拉取最新代码，不重建
#   --rebuild     强制重建所有镜像
#   --with-worker 同时启动异步 worker
#   --with-qdrant 同时启动 Qdrant 向量数据库
#   --down        停止所有服务
#   --logs        查看实时日志
#   --status      查看服务状态
#   --cn          强制启用中国大陆加速
#   --no-cn       强制禁用中国大陆加速

set -e

# ── 颜色 ──
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

# ── 辅助函数 ──
info()  { echo -e "${CYAN}ℹ  $1${NC}"; }
ok()    { echo -e "${GREEN}✅ $1${NC}"; }
warn()  { echo -e "${YELLOW}⚠️  $1${NC}"; }
error() { echo -e "${RED}❌ $1${NC}"; exit 1; }

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

# ── 配置 Docker 镜像加速 ──
setup_docker_mirror() {
    if [ "$CN_MIRROR" != "true" ]; then
        return
    fi

    local DAEMON_JSON="/etc/docker/daemon.json"
    local NEED_RESTART=false

    # 检查是否已配置镜像加速
    if [ -f "$DAEMON_JSON" ] && grep -q "registry-mirrors" "$DAEMON_JSON"; then
        info "Docker 镜像加速已配置，跳过"
        return
    fi

    info "配置 Docker 镜像加速..."

    # 备份已有配置
    if [ -f "$DAEMON_JSON" ]; then
        cp "$DAEMON_JSON" "${DAEMON_JSON}.bak"
    fi

    # 写入镜像加速配置
    cat > "$DAEMON_JSON" << 'EOF'
{
  "registry-mirrors": [
    "https://docker.1ms.run",
    "https://docker.xuanyuan.me"
  ]
}
EOF

    # 重启 Docker
    if systemctl is-active --quiet docker; then
        info "重启 Docker 使镜像加速生效..."
        systemctl daemon-reload
        systemctl restart docker
        sleep 2
        ok "Docker 镜像加速已生效"
    fi
}

# ── 检查 Docker ──
check_docker() {
    if ! command -v docker &>/dev/null; then
        error "未安装 Docker，请先安装: https://docs.docker.com/engine/install/"
    fi
    if ! docker compose version &>/dev/null; then
        error "未安装 Docker Compose V2，请升级 Docker"
    fi
    ok "Docker 环境就绪"
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

# ── 拉取代码 ──
pull_code() {
    if [ -d ".git" ]; then
        info "拉取最新代码..."
        git pull --ff-only origin main || {
            warn "Git pull 失败，可能有本地修改。请手动处理后重试"
            exit 1
        }
        ok "代码已更新到最新版本"
    else
        warn "不是 Git 仓库，跳过代码拉取"
    fi
}

# ── 构建 profiles 参数 ──
build_profiles() {
    PROFILES=""
    if [ "$WITH_WORKER" = true ]; then
        PROFILES="$PROFILES --profile worker"
    fi
    if [ "$WITH_QDRANT" = true ]; then
        PROFILES="$PROFILES --profile qdrant"
    fi
    echo "$PROFILES"
}

# ── 部署 ──
deploy() {
    check_docker
    check_env
    detect_cn

    # 配置 Docker 镜像加速（仅中国大陆）
    if [ "$CN_MIRROR" = "true" ]; then
        setup_docker_mirror
    fi

    # 导出 CN_MIRROR 供 docker-compose.yml 的 build args 读取
    export CN_MIRROR

    PROFILES=$(build_profiles)

    if [ "$FORCE_REBUILD" = true ]; then
        info "强制重建所有镜像..."
        docker compose $PROFILES build --no-cache
    fi

    info "启动所有服务..."
    docker compose $PROFILES up --build -d

    # 自动清理：只删除悬空镜像（旧构建残留），保留构建缓存供下次复用
    info "清理悬空镜像..."
    docker image prune -f > /dev/null 2>&1 || true

    echo ""
    ok "部署完成！"
    echo ""
    echo -e "${CYAN}服务地址:${NC}"
    echo -e "  🌐 前端:     http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo 'localhost'):80"
    echo -e "  ⚙️  后端 API: http://localhost:8000"
    echo -e "  🐘 数据库:   postgresql://localhost:5432"
    echo -e "  📊 Draw.io:  http://localhost:9022"
    if [ "$WITH_QDRANT" = true ]; then
        echo -e "  🔍 Qdrant:   http://localhost:6333"
    fi
    echo ""
    echo -e "${CYAN}常用命令:${NC}"
    echo "  ./deploy.sh --logs       查看实时日志"
    echo "  ./deploy.sh --status     查看服务状态"
    echo "  ./deploy.sh --down       停止所有服务"
    echo "  ./deploy.sh --rebuild    强制重建并部署"
    echo "  ./deploy.sh --clean      深度清理 Docker 磁盘空间"
}

# ── 停止 ──
stop_all() {
    info "停止所有服务..."
    PROFILES=$(build_profiles)
    docker compose $PROFILES down
    ok "所有服务已停止"
}

# ── 日志 ──
show_logs() {
    docker compose logs -f --tail=100
}

# ── 状态 ──
show_status() {
    echo -e "${CYAN}╔══════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║    SmartDiagram 服务状态             ║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════╝${NC}"
    echo ""
    docker compose ps
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
ACTION="deploy"

for arg in "$@"; do
    case $arg in
        --pull)
            pull_code
            exit 0
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
            echo "  --pull         仅拉取最新代码"
            echo "  --rebuild      强制重建所有镜像"
            echo "  --with-worker  同时启动异步 worker"
            echo "  --with-qdrant  同时启动 Qdrant"
            echo "  --cn           强制启用中国大陆加速"
            echo "  --no-cn        强制禁用中国大陆加速"
            echo "  --down         停止所有服务"
            echo "  --logs         查看实时日志"
            echo "  --status       查看服务状态"
            echo "  --clean        深度清理 Docker 磁盘空间"
            exit 0
            ;;
        *)
            warn "未知参数: $arg"
            ;;
    esac
done

case $ACTION in
    deploy)  deploy     ;;
    stop)    stop_all   ;;
    logs)    show_logs  ;;
    status)  show_status ;;
    clean)   deep_clean ;;
esac
