"""Run the real resume-to-ATS workflow against a running local API."""

from __future__ import annotations

import argparse
import hashlib
import json
import time
import uuid
from pathlib import Path
from urllib import error, request


DEFAULT_JD = (
    "招聘能够使用 React、TypeScript、Python、AI agent、RAG 和自动化工作流，"
    "完成真实业务系统交付的人才。"
)


def _multipart(fields: dict[str, str], file_path: Path) -> tuple[bytes, str]:
    boundary = f"----SmartDiagramSmoke{uuid.uuid4().hex}"
    chunks: list[bytes] = []
    for key, value in fields.items():
        chunks.extend(
            [
                f"--{boundary}\r\n".encode(),
                f'Content-Disposition: form-data; name="{key}"\r\n\r\n'.encode(),
                value.encode("utf-8"),
                b"\r\n",
            ]
        )
    chunks.extend(
        [
            f"--{boundary}\r\n".encode(),
            (
                f'Content-Disposition: form-data; name="file"; '
                f'filename="{file_path.name}"\r\n'
            ).encode(),
            b"Content-Type: application/pdf\r\n\r\n",
            file_path.read_bytes(),
            b"\r\n",
            f"--{boundary}--\r\n".encode(),
        ]
    )
    return b"".join(chunks), boundary


def _request_json(
    method: str,
    url: str,
    headers: dict[str, str],
    body: bytes | None = None,
) -> dict:
    try:
        response = request.urlopen(
            request.Request(url, data=body, headers=headers, method=method),
            timeout=180,
        )
        return json.loads(response.read().decode("utf-8"))
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {url} returned {exc.code}: {detail}") from exc


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=Path(__file__).resolve().parents[3] / "data",
    )
    parser.add_argument("--tenant-id", default=f"smoke-resume-{int(time.time())}")
    args = parser.parse_args()

    files = sorted(args.data_dir.glob("*.pdf"))
    if not files:
        raise SystemExit(f"No PDF resumes found in {args.data_dir}")

    headers = {
        "x-tenant-id": args.tenant_id,
        "x-user-id": "smoke-test-user",
        "x-roles": "owner",
        "x-scopes": "project:read,project:write,diagram:read,diagram:write",
    }
    results: list[dict] = []
    for file_path in files:
        digest = hashlib.sha256(file_path.read_bytes()).hexdigest()[:12]
        body, boundary = _multipart(
            {
                "jd_title": "AI 应用产品工程师（业务系统方向）",
                "jd_text": DEFAULT_JD,
                "candidate_name": file_path.stem,
                "email": f"{digest}@smoke.local",
                "source_channel": "local-data-smoke",
                "priority": "high",
                "resume_text": "",
            },
            file_path,
        )
        response = _request_json(
            "POST",
            f"{args.base_url}/api/recruit/workbench",
            {**headers, "Content-Type": f"multipart/form-data; boundary={boundary}"},
            body,
        )
        candidate_id = response["candidate"]["candidate_id"]
        detail = _request_json(
            "GET",
            f"{args.base_url}/api/recruit/candidates/{candidate_id}",
            headers,
        )
        screening = detail["screenings"][0]
        result = {
            "file": file_path.name,
            "candidate_id": candidate_id,
            "score": screening["total_score"],
            "recommendation": screening["recommendation"],
            "evaluation_mode": screening["evaluation_mode"],
            "score_version": screening["score_version"],
            "resume_records": len(detail["resumes"]),
            "question_sets": len(detail["question_sets"]),
            "interview_questions": len(screening["interview_questions"]),
        }
        results.append(result)
        print(json.dumps(result, ensure_ascii=False))

    print(
        json.dumps(
            {
                "tenant_id": args.tenant_id,
                "processed": len(results),
                "persisted": sum(
                    item["resume_records"] == 1 and item["question_sets"] >= 1
                    for item in results
                ),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
