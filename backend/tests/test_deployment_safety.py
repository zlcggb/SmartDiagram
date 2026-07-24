from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
DESTRUCTIVE_SQL = re.compile(r"\b(?:DROP|TRUNCATE)\b|\bDELETE\s+FROM\b", re.IGNORECASE)


def _run_secret_bootstrap(env_file: Path, *, secret: str | None = None) -> subprocess.CompletedProcess[str]:
    environment = os.environ.copy()
    environment.pop("PPT_INTERNAL_API_SECRET", None)
    if secret is not None:
        environment["PPT_INTERNAL_API_SECRET"] = secret
    return subprocess.run(
        ["bash", str(REPO_ROOT / "scripts" / "ensure-deploy-secret.sh"), str(env_file)],
        cwd=REPO_ROOT,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )


def _dotenv_values(env_file: Path, key: str) -> list[str]:
    prefix = f"{key}="
    return [
        line.removeprefix(prefix).strip().strip("\"'")
        for line in env_file.read_text(encoding="utf-8").splitlines()
        if line.startswith(prefix)
    ]


def test_deploy_secret_bootstrap_generates_once_with_private_permissions(tmp_path: Path) -> None:
    env_file = tmp_path / ".env"

    first = _run_secret_bootstrap(env_file)

    assert first.returncode == 0, first.stderr
    values = _dotenv_values(env_file, "PPT_INTERNAL_API_SECRET")
    assert len(values) == 1
    assert re.fullmatch(r"[0-9a-f]{64}", values[0])
    assert env_file.stat().st_mode & 0o777 == 0o600
    assert values[0] not in first.stdout
    assert values[0] not in first.stderr

    second = _run_secret_bootstrap(env_file)

    assert second.returncode == 0, second.stderr
    assert _dotenv_values(env_file, "PPT_INTERNAL_API_SECRET") == values


def test_deploy_secret_bootstrap_replaces_placeholders_and_deduplicates_key(tmp_path: Path) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text(
        "OTHER_SETTING=keep-me\n"
        "PPT_INTERNAL_API_SECRET=\n"
        "ANOTHER_SETTING=also-keep\n"
        "PPT_INTERNAL_API_SECRET=replace-with-a-long-random-value\n",
        encoding="utf-8",
    )

    result = _run_secret_bootstrap(env_file)

    assert result.returncode == 0, result.stderr
    content = env_file.read_text(encoding="utf-8")
    values = _dotenv_values(env_file, "PPT_INTERNAL_API_SECRET")
    assert len(values) == 1
    assert re.fullmatch(r"[0-9a-f]{64}", values[0])
    assert "OTHER_SETTING=keep-me" in content
    assert "ANOTHER_SETTING=also-keep" in content


def test_deploy_secret_bootstrap_rejects_short_existing_secret_without_rewriting(tmp_path: Path) -> None:
    env_file = tmp_path / ".env"
    original = "OTHER_SETTING=keep-me\nPPT_INTERNAL_API_SECRET=too-short\n"
    env_file.write_text(original, encoding="utf-8")

    result = _run_secret_bootstrap(env_file)

    assert result.returncode != 0
    assert "32" in result.stderr
    assert env_file.read_text(encoding="utf-8") == original


def test_deploy_secret_bootstrap_respects_external_secret_without_writing_file(tmp_path: Path) -> None:
    env_file = tmp_path / ".env"
    external_secret = "x" * 32

    result = _run_secret_bootstrap(env_file, secret=external_secret)

    assert result.returncode == 0, result.stderr
    assert not env_file.exists()
    assert external_secret not in result.stdout
    assert external_secret not in result.stderr


def test_deploy_bootstraps_ppt_secret_before_compose_actions() -> None:
    script = (REPO_ROOT / "deploy.sh").read_text(encoding="utf-8")

    assert 'source "$ROOT_DIR/scripts/ensure-deploy-secret.sh"' in script
    assert 'ensure_ppt_internal_api_secret "$ROOT_DIR/.env"' in script
    bootstrap_at = script.index('ensure_ppt_internal_api_secret "$ROOT_DIR/.env"')
    dispatch_at = script.rindex("case $ACTION in")
    assert bootstrap_at < dispatch_at
    pre_dispatch = script[script.rindex("# Compose ", 0, dispatch_at) : dispatch_at]
    assert "ensure_deploy_environment" in pre_dispatch


def test_local_dev_bootstraps_ppt_secret_before_compose_actions() -> None:
    script = (REPO_ROOT / "dev.sh").read_text(encoding="utf-8")
    env_checks_at = script.index("检查 .env")
    infrastructure_at = script.index("基础设施：db / redis / drawio", env_checks_at)
    bootstrap_block = script[env_checks_at:infrastructure_at]

    source_at = bootstrap_block.index(
        'source "$ROOT_DIR/scripts/ensure-deploy-secret.sh"'
    )
    ensure_at = bootstrap_block.index(
        'ensure_ppt_internal_api_secret "$ROOT_DIR/.env"', source_at
    )

    assert source_at < ensure_at


def test_deploy_prunes_only_current_project_unused_images_above_85_percent() -> None:
    script = (REPO_ROOT / "deploy.sh").read_text(encoding="utf-8")
    deploy_body = script[script.index("deploy() {") : script.index("backup_only() {")]

    assert "root_disk_usage_percent" in script
    assert "compose_project_name" in script
    assert "prune_unused_images_when_disk_is_high" in script
    assert 'if [ "$usage_percent" -le 85 ]' in script
    assert "docker compose config --format json" in script
    assert "docker image prune -a -f --filter" in script
    assert '"label=com.docker.compose.project=${project_name}"' in script

    cleanup_at = deploy_body.index("prune_unused_images_when_disk_is_high")
    mirror_at = deploy_body.index("check_docker_mirror")
    backup_at = deploy_body.index("backup_data")
    assert cleanup_at < mirror_at < backup_at
    assert deploy_body.count("prune_unused_images_when_disk_is_high") == 2
    assert "docker image prune" not in deploy_body

    assert "docker volume prune" not in script
    assert "docker system prune --volumes" not in script


def test_deploy_script_never_removes_named_volumes() -> None:
    script = (REPO_ROOT / "deploy.sh").read_text(encoding="utf-8")

    assert "down -v" not in script
    assert "down --volumes" not in script
    assert "docker volume prune" not in script
    assert "backup_data" in script
    assert "migrate_databases" in script
    assert "detect_legacy_storage_layout" in script
    assert "migrate_legacy_storage" in script


def test_local_dev_waits_for_database_and_migrates_before_starting_apps() -> None:
    script = (REPO_ROOT / "dev.sh").read_text(encoding="utf-8")

    infrastructure_at = script.index("start_infrastructure")
    wait_at = script.index("wait_for_database", infrastructure_at)
    main_migration_at = script.index("uv run python scripts/migrate_database.py", wait_at)
    ppt_database_at = script.index(
        "docker compose run --rm --no-deps ppt-db-init", main_migration_at
    )
    ppt_migration_at = script.index("corepack pnpm db:migrate", ppt_database_at)
    backend_start_at = script.index("# ────────── 启动后端服务")

    assert infrastructure_at < wait_at < main_migration_at
    assert main_migration_at < ppt_database_at < ppt_migration_at < backend_start_at
    assert "docker compose up -d db redis drawio" in script
    assert "docker compose exec -T db pg_isready" in script
    assert "docker compose logs --tail=80 db" in script
    assert "docker compose down -v" not in script


def test_ppt_database_initializer_uses_lightweight_postgres_client() -> None:
    compose = (REPO_ROOT / "docker-compose.yml").read_text(encoding="utf-8")
    init_compose = compose[compose.index("  ppt-db-init:") : compose.index("\n  redis:")]

    assert "image: postgres:16-alpine" in init_compose
    assert "CREATE DATABASE ppt_agent" in init_compose


def test_local_dev_fails_fast_when_docker_or_database_is_unavailable() -> None:
    script = (REPO_ROOT / "dev.sh").read_text(encoding="utf-8")
    main_flow_at = script.index("# ────────── 基础设施：db / redis / drawio")
    port_check_at = script.index("check_required_ports", main_flow_at)
    infrastructure_at = script.index("start_infrastructure", port_check_at)

    assert "command -v docker" in script
    assert "docker info" in script
    assert "infrastructure_is_healthy" in script
    assert "复用已就绪的基础设施容器" in script
    assert port_check_at < infrastructure_at
    assert "端口 ${port} 已被占用" in script
    assert "旧的 npm run dev" in script
    assert "数据库未能在" in script
    assert "若后端报数据库错误请手动检查" not in script


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
