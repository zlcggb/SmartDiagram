#!/bin/bash
# SmartDiagram — 跨服务器数据迁移与整机割接统一入口脚本
# 用法:
#   ./migrate.sh export [选项]           # 【老服务器】一键全量导出打包
#   ./migrate.sh restore [归档包] [选项] # 【新服务器】一键解压恢复与全栈部署
#   ./migrate.sh help                    # 查看帮助说明

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

show_help() {
    echo "=========================================================="
    echo "       SmartDiagram 跨服务器一键数据迁移工具              "
    echo "=========================================================="
    echo "用法:"
    echo "  ./migrate.sh export [选项]"
    echo "      在【老服务器】执行：一键打包双PostgreSQL数据库、用户上传资料、"
    echo "      PPT素材、向量库及 .env 配置为单一压缩包。"
    echo ""
    echo "      选项:"
    echo "        --output <路径>   自定义输出压缩包路径"
    echo "        --low-mem         启用低内存保护 (自动暂停重型服务，防 OOM 崩溃)"
    echo "        --keep-stopped    导出后保持重型容器停止 (老机器准备下线)"
    echo ""
    echo "  ./migrate.sh restore [归档包路径] [选项]"
    echo "      在【新服务器】执行：一键解压还原数据库、文件卷、权限校准与服务部署。"
    echo ""
    echo "      选项:"
    echo "        --no-deploy       仅恢复数据和配置，不启动全栈应用"
    echo "        --skip-checksum   跳过 SHA256 完整性检查"
    echo ""
    echo "  ./migrate.sh help"
    echo "      显示本帮助说明。"
    echo "=========================================================="
}

if [ $# -eq 0 ]; then
    show_help
    exit 0
fi

COMMAND="$1"
shift

case "$COMMAND" in
    export)
        bash "$ROOT_DIR/scripts/migration-export.sh" "$@"
        ;;
    restore|import)
        bash "$ROOT_DIR/scripts/migration-restore.sh" "$@"
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        echo -e "${RED}❌ 未知子命令: $COMMAND${NC}"
        echo ""
        show_help
        exit 1
        ;;
esac
