from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
DESTRUCTIVE_SQL = re.compile(r"\b(?:DROP|TRUNCATE)\b|\bDELETE\s+FROM\b", re.IGNORECASE)


def test_deploy_script_never_removes_named_volumes() -> None:
    script = (REPO_ROOT / "deploy.sh").read_text(encoding="utf-8")

    assert "down -v" not in script
    assert "down --volumes" not in script
    assert "docker volume prune" not in script
    assert "backup_data" in script
    assert "migrate_databases" in script
    assert "detect_legacy_storage_layout" in script
    assert "migrate_legacy_storage" in script


def test_user_volume_backup_mounts_are_read_only() -> None:
    compose = (REPO_ROOT / "docker-compose.yml").read_text(encoding="utf-8")

    for volume in ("pptdata", "knowledgedata", "qdrantdata"):
        assert f"{volume}:/source/{volume}:ro" in compose

    assert "Target knowledge volume is not empty; refusing to overwrite" in compose


def test_baota_mirror_is_checked_without_overwriting_daemon_config() -> None:
    script = (REPO_ROOT / "deploy.sh").read_text(encoding="utf-8")
    ppt_dockerfile = (REPO_ROOT / "ppt-agent-engine" / "Dockerfile").read_text(encoding="utf-8")

    assert "docker pull hello-world:latest" in script
    assert "docker.1ms.run" in script
    assert 'cat > "$DAEMON_JSON"' not in script
    assert "# syntax=docker/dockerfile" not in ppt_dockerfile

def test_china_deploy_uses_configurable_ghcr_mirror_before_backup() -> None:
    script = (REPO_ROOT / "deploy.sh").read_text(encoding="utf-8")
    compose = (REPO_ROOT / "docker-compose.yml").read_text(encoding="utf-8")
    backend_dockerfile = (REPO_ROOT / "backend" / "Dockerfile").read_text(encoding="utf-8")
    frontend_dockerfile = (REPO_ROOT / "frontend" / "Dockerfile").read_text(encoding="utf-8")
    gateway_dockerfile = (REPO_ROOT / "gateway" / "Dockerfile").read_text(encoding="utf-8")
    ppt_dockerfile = (REPO_ROOT / "ppt-agent-engine" / "Dockerfile").read_text(encoding="utf-8")
    gateway_compose = compose[compose.index("  gateway:") : compose.index("\n  backup-volumes:")]

    assert "configure_build_image_sources" in script
    assert "ghcr.1ms.run/astral-sh/uv:0.10.5" in script
    assert 'docker pull "$UV_IMAGE"' in script
    assert script.index("check_docker_mirror") < script.index("backup_data")

    assert "UV_PYTHON_IMAGE: ${UV_PYTHON_IMAGE:-ghcr.io/astral-sh/uv:python3.13-bookworm-slim}" in compose
    assert "UV_IMAGE: ${UV_IMAGE:-ghcr.io/astral-sh/uv:0.10.5}" in compose

    assert "ARG UV_PYTHON_IMAGE=ghcr.io/astral-sh/uv:python3.13-bookworm-slim" in backend_dockerfile
    assert "FROM ${UV_PYTHON_IMAGE}" in backend_dockerfile
    assert "ARG UV_PYTHON_IMAGE=ghcr.io/astral-sh/uv:python3.13-bookworm-slim" in frontend_dockerfile
    assert "FROM ${UV_PYTHON_IMAGE}" in frontend_dockerfile
    assert "UV_PYTHON_IMAGE" in gateway_compose
    assert "ARG UV_PYTHON_IMAGE=ghcr.io/astral-sh/uv:python3.13-bookworm-slim" in gateway_dockerfile
    assert "FROM ${UV_PYTHON_IMAGE}" in gateway_dockerfile
    assert "ARG UV_IMAGE=ghcr.io/astral-sh/uv:0.10.5" in ppt_dockerfile
    assert "FROM ${UV_IMAGE} AS uv-tools" in ppt_dockerfile
    assert "COPY --from=uv-tools /uv /uvx /bin/" in ppt_dockerfile


def test_database_migration_script_imports_app_when_executed_by_path() -> None:
    backend_dir = REPO_ROOT / "backend"
    import_check = """
import runpy
import sys
from pathlib import Path

backend_dir = Path(sys.argv[1]).resolve()
scripts_dir = backend_dir / "scripts"
sys.path = [str(scripts_dir)] + [
    entry
    for entry in sys.path
    if entry and Path(entry).resolve() != backend_dir
]
runpy.run_path(str(scripts_dir / "migrate_database.py"), run_name="deployment_import_check")
"""

    result = subprocess.run(
        [sys.executable, "-c", import_check, str(backend_dir)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr


def test_gateway_owns_default_public_port_and_frontend_is_internal_only() -> None:
    compose = (REPO_ROOT / "docker-compose.yml").read_text(encoding="utf-8")
    env_example = (REPO_ROOT / ".env.example").read_text(encoding="utf-8")
    deploy_script = (REPO_ROOT / "deploy.sh").read_text(encoding="utf-8")
    frontend_compose = compose[
        compose.index("  frontend:") : compose.index("\n  # ================= PPT Agent")
    ]
    gateway_compose = compose[compose.index("  gateway:") : compose.index("\n  backup-volumes:")]

    assert "    ports:" not in frontend_compose
    assert '    expose:\n      - "80"' in frontend_compose
    assert '"${GATEWAY_PORT:-9237}:80"' in gateway_compose
    assert "GATEWAY_PORT=9237" in env_example
    assert '${GATEWAY_PORT:-9237}' in deploy_script


def test_ppt_shared_volume_permissions_are_initialized_before_services() -> None:
    compose = (REPO_ROOT / "docker-compose.yml").read_text(encoding="utf-8")
    init_compose = compose[
        compose.index("  ppt-storage-init:") : compose.index("\n  ppt-node-api:")
    ]
    node_compose = compose[
        compose.index("  ppt-node-api:") : compose.index("\n  # FastAPI")
    ]
    python_compose = compose[
        compose.index("  ppt-python-api:") : compose.index("\n  # PPT Agent 前端")
    ]

    assert "user: \"0:0\"" in init_compose
    assert "pptdata:/data" in init_compose
    assert "mkdir -p /data/storage /data/langgraph" in init_compose
    assert "chown -R 1000:1000 /data/storage" in init_compose
    assert "chown -R 10001:10001 /data/langgraph" in init_compose
    assert "rm " not in init_compose
    assert "ppt-storage-init:\n        condition: service_completed_successfully" in node_compose
    assert "ppt-storage-init:\n        condition: service_completed_successfully" in python_compose


def test_deploy_resumes_paused_services_before_compose_recreates_containers() -> None:
    script = (REPO_ROOT / "deploy.sh").read_text(encoding="utf-8")
    deploy_body = script[script.index("deploy() {") : script.index("\n# ── 停止 ──")]

    migrate_at = deploy_body.index("migrate_databases")
    resume_at = deploy_body.index("resume_writers", migrate_at)
    ensure_at = deploy_body.index("ensure_no_paused_services", resume_at)
    compose_up_at = deploy_body.index("compose up -d --remove-orphans", ensure_at)

    assert migrate_at < resume_at < ensure_at < compose_up_at
    assert "ps --status paused --services" in script
    assert 'unpause "$service"' in script
    assert "仍有服务处于暂停状态，停止容器切换" in script


def test_update_reexecutes_when_deploy_script_itself_changes() -> None:
    script = (REPO_ROOT / "deploy.sh").read_text(encoding="utf-8")
    pull_body = script[script.index("pull_code() {") : script.index("\n# ── 构建 profiles 参数 ──")]

    assert 'ORIGINAL_ARGS=("$@")' in script
    assert 'git diff --quiet "$before_revision" "$after_revision" -- deploy.sh' in pull_body
    assert 'SMARTDIAGRAM_DEPLOY_REEXECED=true exec "$ROOT_DIR/deploy.sh" "${ORIGINAL_ARGS[@]}"' in pull_body
    assert "部署脚本连续自更新，已停止以避免重复执行" in pull_body


def test_committed_ppt_migrations_are_non_destructive() -> None:
    migrations = REPO_ROOT / "ppt-agent-engine" / "prisma" / "migrations"
    sql_files = sorted(migrations.glob("*/migration.sql"))

    assert sql_files
    for sql_file in sql_files:
        sql = sql_file.read_text(encoding="utf-8")
        assert not DESTRUCTIVE_SQL.search(sql), f"destructive SQL requires manual deployment review: {sql_file}"
