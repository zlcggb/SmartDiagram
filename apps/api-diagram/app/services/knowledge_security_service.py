"""Deterministic security scanning for retrieved knowledge chunks."""

import re
from typing import Any, Literal, TypedDict

from app.core.config import settings


Severity = Literal["none", "low", "medium", "high"]
PolicyAction = Literal["allow", "review", "block"]


class KnowledgeSecurityFinding(TypedDict):
    code: str
    severity: Severity
    message: str
    matched_text: str


class KnowledgeSecurityScan(TypedDict):
    safe_for_prompt: bool
    severity: Severity
    finding_count: int
    findings: list[KnowledgeSecurityFinding]


class KnowledgeSecurityPolicyDecision(TypedDict):
    action: PolicyAction
    safe_for_prompt: bool
    severity: Severity
    policy_mode: str
    block_threshold: Severity
    confidence: float
    reason: str
    finding_codes: list[str]
    trusted_term_hits: list[str]
    redacted_preview: str


SCAN_RULES: list[dict[str, Any]] = [
    {
        "code": "ignore_instructions",
        "severity": "high",
        "message": "Content asks the model to ignore or override prior instructions.",
        "patterns": [
            r"ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|rules|prompts)",
            r"忽略(之前|以上|所有).{0,12}(指令|规则|提示)",
            r"不要遵守.{0,12}(系统|开发者|安全).{0,12}(指令|规则)",
        ],
    },
    {
        "code": "system_prompt_exfiltration",
        "severity": "high",
        "message": "Content asks the model to reveal hidden prompts or internal instructions.",
        "patterns": [
            r"(reveal|print|show|dump)\s+(the\s+)?(system|developer)\s+(prompt|message|instructions)",
            r"泄露.{0,12}(系统|开发者).{0,12}(提示词|指令|消息)",
            r"输出.{0,12}(系统|开发者).{0,12}(提示词|指令|消息)",
        ],
    },
    {
        "code": "tool_or_secret_exfiltration",
        "severity": "high",
        "message": "Content requests secret, credential, or unauthorized tool exfiltration.",
        "patterns": [
            r"(exfiltrate|steal|leak)\s+.{0,40}(api[_ -]?key|token|secret|password|credential)",
            r"(send|post|upload)\s+.{0,80}(secret|credential|token|api[_ -]?key)\s+.{0,40}(http|https|webhook)",
            r"窃取.{0,20}(密钥|令牌|密码|凭证)",
        ],
    },
    {
        "code": "roleplay_override",
        "severity": "medium",
        "message": "Content attempts to force a roleplay or policy bypass context.",
        "patterns": [
            r"you\s+are\s+now\s+(dan|developer\s+mode|unrestricted)",
            r"进入.{0,8}(开发者模式|无限制模式|越狱模式)",
        ],
    },
    {
        "code": "prompt_boundary_injection",
        "severity": "medium",
        "message": "Content contains prompt-boundary markers often used in injection payloads.",
        "patterns": [
            r"</?(system|developer|assistant|tool|instruction)>",
            r"```(system|developer|assistant|tool)",
            r"begin\s+(system|developer)\s+(prompt|message)",
        ],
    },
]

SEVERITY_RANK: dict[Severity, int] = {
    "none": 0,
    "low": 1,
    "medium": 2,
    "high": 3,
}


def _max_severity(findings: list[KnowledgeSecurityFinding]) -> Severity:
    severity: Severity = "none"
    for finding in findings:
        if SEVERITY_RANK[finding["severity"]] > SEVERITY_RANK[severity]:
            severity = finding["severity"]
    return severity


def _severity_from_config(value: str | None, default: Severity = "high") -> Severity:
    normalized = (value or default).lower()
    if normalized in SEVERITY_RANK:
        return normalized  # type: ignore[return-value]
    return default


def _trusted_terms() -> list[str]:
    return [
        term.strip().lower()
        for term in settings.KNOWLEDGE_SECURITY_TRUSTED_TERMS.split(",")
        if term.strip()
    ]


def _trusted_term_hits(text: str) -> list[str]:
    lowered = text.lower()
    return [term for term in _trusted_terms() if term and term in lowered]


def _confidence(scan: KnowledgeSecurityScan) -> float:
    if scan["severity"] == "high":
        return 0.95
    if scan["severity"] == "medium":
        return 0.72
    if scan["severity"] == "low":
        return 0.45
    return 0.05


def _redacted_preview(text: str) -> str:
    preview = re.sub(
        r"(?i)(api[_ -]?key|token|secret|password|credential)\s*[:=]\s*\S+",
        r"\1=[REDACTED]",
        text[:500],
    )
    return preview.replace("\n", " ")[:240]


def scan_knowledge_text(text: str) -> KnowledgeSecurityScan:
    """Scan a knowledge text block for prompt-injection indicators."""

    findings: list[KnowledgeSecurityFinding] = []
    for rule in SCAN_RULES:
        for pattern in rule["patterns"]:
            match = re.search(pattern, text, flags=re.IGNORECASE | re.MULTILINE)
            if not match:
                continue
            findings.append(
                {
                    "code": rule["code"],
                    "severity": rule["severity"],
                    "message": rule["message"],
                    "matched_text": match.group(0)[:160],
                }
            )
            break

    severity = _max_severity(findings)
    return {
        "safe_for_prompt": SEVERITY_RANK[severity] < SEVERITY_RANK["high"],
        "severity": severity,
        "finding_count": len(findings),
        "findings": findings,
    }


def evaluate_knowledge_security_policy(
    text: str,
    *,
    scan: KnowledgeSecurityScan | None = None,
) -> KnowledgeSecurityPolicyDecision:
    """Evaluate a prompt-injection policy decision for one knowledge text.

    The current policy is a deterministic rule engine with an explicit extension
    point (`policy_mode`) for future ML/rule hybrid classifiers. Trusted terms
    do not make unsafe content safe; they only downgrade medium findings to
    review so business templates are not blocked too aggressively.
    """

    active_scan = scan or scan_knowledge_text(text)
    block_threshold = _severity_from_config(settings.KNOWLEDGE_SECURITY_BLOCK_SEVERITY)
    trusted_hits = _trusted_term_hits(text)
    severity = active_scan["severity"]
    severity_rank = SEVERITY_RANK[severity]
    block_rank = SEVERITY_RANK[block_threshold]
    action: PolicyAction = "allow"
    reason = "no_policy_findings"

    if severity_rank >= block_rank and severity != "none":
        action = "block"
        reason = f"severity_at_or_above_{block_threshold}"
    elif severity_rank >= SEVERITY_RANK["medium"]:
        action = "review"
        reason = "medium_risk_requires_review"

    if action == "block" and severity == "medium" and trusted_hits:
        action = "review"
        reason = "trusted_business_context_downgraded_medium_finding"

    return {
        "action": action,
        "safe_for_prompt": action != "block",
        "severity": severity,
        "policy_mode": settings.KNOWLEDGE_SECURITY_POLICY_MODE,
        "block_threshold": block_threshold,
        "confidence": _confidence(active_scan),
        "reason": reason,
        "finding_codes": [finding["code"] for finding in active_scan["findings"]],
        "trusted_term_hits": trusted_hits,
        "redacted_preview": _redacted_preview(text),
    }


def scan_knowledge_chunk_payload(payload: dict[str, Any]) -> KnowledgeSecurityScan:
    """Scan parsed chunk payload fields before persistence."""

    return scan_knowledge_text(
        "\n".join(
            [
                str(payload.get("heading_path") or ""),
                str(payload.get("summary") or ""),
                str(payload.get("text") or ""),
            ]
        )
    )


def evaluate_knowledge_chunk_policy(payload: dict[str, Any]) -> KnowledgeSecurityPolicyDecision:
    """Evaluate the configured policy for parsed chunk payload fields."""

    text = "\n".join(
        [
            str(payload.get("heading_path") or ""),
            str(payload.get("summary") or ""),
            str(payload.get("text") or ""),
        ]
    )
    return evaluate_knowledge_security_policy(text)


def summarize_scan(scan: KnowledgeSecurityScan) -> dict[str, Any]:
    """Return a compact scan summary safe for API and audit metadata."""

    return {
        "safe_for_prompt": scan["safe_for_prompt"],
        "severity": scan["severity"],
        "finding_count": scan["finding_count"],
        "finding_codes": [finding["code"] for finding in scan["findings"]],
    }


def summarize_policy(decision: KnowledgeSecurityPolicyDecision) -> dict[str, Any]:
    """Return compact policy metadata safe for API responses and audit logs."""

    return {
        "action": decision["action"],
        "safe_for_prompt": decision["safe_for_prompt"],
        "severity": decision["severity"],
        "policy_mode": decision["policy_mode"],
        "block_threshold": decision["block_threshold"],
        "confidence": decision["confidence"],
        "reason": decision["reason"],
        "finding_codes": decision["finding_codes"],
        "trusted_term_hits": decision["trusted_term_hits"],
    }
