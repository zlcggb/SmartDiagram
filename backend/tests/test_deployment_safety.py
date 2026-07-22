from __future__ import annotations

import re
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


def test_committed_ppt_migrations_are_non_destructive() -> None:
    migrations = REPO_ROOT / "ppt-agent-engine" / "prisma" / "migrations"
    sql_files = sorted(migrations.glob("*/migration.sql"))

    assert sql_files
    for sql_file in sql_files:
        sql = sql_file.read_text(encoding="utf-8")
        assert not DESTRUCTIVE_SQL.search(sql), f"destructive SQL requires manual deployment review: {sql_file}"
