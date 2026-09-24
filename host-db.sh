#!/usr/bin/env bash
# Run migration/deployment using the host PostgreSQL server.
set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
export COMPOSE_FILE="$ROOT_DIR/docker-compose.yml:$ROOT_DIR/docker-compose.host-db.yml"
export SMARTDIAGRAM_HOST_DB=1
if ! docker network inspect smartdiagram_hostdb >/dev/null 2>&1; then
  docker network create --subnet "${HOST_DB_DOCKER_SUBNET:-172.30.77.0/24}" smartdiagram_hostdb >/dev/null
fi
case "${1:-}" in
  restore|export)
    exec "$ROOT_DIR/migrate.sh" "$@"
    ;;
  deploy)
    shift
    exec "$ROOT_DIR/deploy.sh" "$@"
    ;;
  *)
    echo "Usage: ./host-db.sh restore <bundle> | deploy [deploy.sh options]" >&2
    exit 2
    ;;
esac
