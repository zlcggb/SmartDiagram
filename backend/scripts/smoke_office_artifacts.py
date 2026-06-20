"""Smoke checks for the office artifact MVP."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.agents.planner_agent import ENGINE_OUTPUT_CONTRACTS
from app.agents.context import format_knowledge_context
from app.agents.design_agent import optimize_diagram_design
from app.agents.router import detect_task_from_keywords
from app.models.knowledge import DiagramTemplate
from app.models.diagram import DiagramVersion
from app.services.diagram_template_service import serialize_diagram_template
from app.services.export_job_service import render_result_for_format
from app.services.export_renderers import RenderUnsupported
from app.services.html_artifact_renderer import EMAIL_TEMPLATE_OPTIONS, render_html_artifact
from app.services.long_term_memory_service import format_long_term_preferences_for_prompt, sanitize_diagram_preferences
from app.services.output_repair import repair_output
from app.services.output_validation import validate_output


EMAIL_ARTIFACT = {
    "artifact_type": "html_email",
    "template": "executive_brief",
    "title": "客户续费提醒邮件",
    "language": "zh-CN",
    "audience": "企业客户采购负责人",
    "tone": "professional",
    "email": {
        "subject": "续费提醒与服务权益说明",
        "preheader": "请在到期前完成续费以保持服务连续",
    },
    "style": {"brand_color": "#2563eb", "max_width": 640},
    "sections": [
        {"type": "hero", "heading": "服务即将到期", "body": "请在到期前完成续费以保持服务连续。"},
        {"type": "list", "heading": "续费权益", "items": ["专属支持", "历史数据保留", "服务不中断"]},
        {"type": "cta", "label": "查看续费方案", "href": "https://example.com/renewal"},
    ],
}

RICH_EMAIL_ARTIFACT = {
    **EMAIL_ARTIFACT,
    "template": "newsletter_update",
    "title": "新品发布增长简报",
    "email": {
        "subject": "SmartFlow 2.0 发布与客户行动建议",
        "preheader": "用结构化指标、进展和行动路径说明本次发布价值",
    },
    "sections": [
        {"type": "hero", "heading": "SmartFlow 2.0 发布简报", "body": "本邮件用于快速说明发布亮点、客户收益和下一步行动。"},
        {
            "type": "metric_grid",
            "heading": "核心业务信号",
            "metrics": [
                {"label": "试用转化", "value": "36%", "delta": "+8%", "note": "来自近期活动线索"},
                {"label": "续费意向", "value": "72%", "delta": "+12%", "note": "销售确认的高意向客户"},
                {"label": "平均响应", "value": "4h", "delta": "-35%", "note": "支持 SLA 改善"},
            ],
        },
        {
            "type": "bar_chart",
            "heading": "客户关注度分布",
            "data": [
                {"label": "自动化报告", "value": 84, "display": "84%"},
                {"label": "权限治理", "value": 68, "display": "68%"},
                {"label": "模板复用", "value": 57, "display": "57%"},
            ],
        },
        {
            "type": "timeline",
            "heading": "建议跟进节奏",
            "items": [
                {"phase": "Day 1", "title": "发送发布邮件", "body": "突出价值与适用人群。"},
                {"phase": "Day 3", "title": "销售二次触达", "body": "补充客户行业场景。"},
            ],
        },
        {
            "type": "comparison",
            "heading": "传统邮件 vs 结构化邮件",
            "items": [
                {"label": "传统邮件", "body": "正文堆叠、编号罗列，读者难以快速抓重点。"},
                {"label": "结构化邮件", "body": "用指标、进度和对比模块提高可读性。"},
            ],
        },
        {"type": "cta", "label": "查看发布资料", "href": "https://example.com/launch"},
    ],
}

BLUEPRINT_EMAIL_ARTIFACT = {
    **EMAIL_ARTIFACT,
    "template": "blueprint_review",
    "title": "CPQ 蓝图方案评审",
    "email": {
        "subject": "CPQ 蓝图方案评审会议纪要",
        "preheader": "构建精准与效率的数字骨架 · 12月15日",
    },
    "footer": "© 2025 Unilumin CPQ Project Team. All Rights Reserved.",
    "sections": [
        {
            "type": "hero",
            "badge": "BLUEPRINT REVIEW 2025",
            "heading": "CPQ 蓝图方案评审",
            "body": "构建精准与效率的数字骨架 · 12月15日",
        },
        {
            "type": "text",
            "heading": "会议背景",
            "body": "CPQ 系统蓝图方案是保障后续系统落地与业务适配的核心基础。本次会议用于确认方案可行性、业务契合度与关键风险。",
        },
        {
            "type": "list",
            "heading": "核心议题：架构与流转",
            "items": [
                {"label": "目标与愿景", "body": "重塑现有报价流程，解决效率低下与数据孤岛问题。"},
                {"label": "系统生态架构", "body": "打通 PBI、APS、数据中台、CRM 的配置、审批与订单链路。"},
            ],
        },
        {
            "type": "comparison",
            "heading": "领导层战略建议",
            "items": [
                {"label": "流程优化", "body": "现货管理需结合计划系统，预留交期评审接口。"},
                {"label": "视觉升级", "body": "报价单首页及子页面 UI 需植入品牌 DNA，提升专业度。"},
            ],
        },
        {
            "type": "table",
            "heading": "行动计划 (Action Items)",
            "columns": ["决议事项", "责任人", "截止日期", "状态"],
            "rows": [
                ["报价单模板的最终法务与销服确认", "李尚胜", "2025-12-22", "进行中"],
                ["英文版 UI 界面视觉优化", "王靖杰", "2026-01-10", "待办"],
            ],
        },
    ],
}

REPORT_ARTIFACT = {
    "artifact_type": "web_report_html",
    "title": "竞品对比分析稿",
    "language": "zh-CN",
    "audience": "经营分析团队",
    "tone": "analytical",
    "sections": [
        {"type": "hero", "heading": "竞品对比分析", "body": "本稿用于快速比较竞品定位、优势和风险。"},
        {"type": "table", "heading": "对比摘要", "columns": ["维度", "我们", "竞品"], "rows": [["价格", "中", "低"]]},
    ],
}

EMAIL_TEMPLATE_CODE = json.dumps(
    {
        **EMAIL_ARTIFACT,
        "title": "客户活动邀请邮件模板",
        "email": {"subject": "活动邀请：{{event_name}}", "preheader": "预留给活动亮点摘要"},
        "sections": [
            {"type": "hero", "heading": "{{event_name}}", "body": "说明活动价值、时间和参会收益。"},
            {"type": "list", "heading": "适合人群", "items": ["采购负责人", "技术负责人", "业务决策人"]},
            {"type": "cta", "label": "预约参会", "href": ""},
        ],
    },
    ensure_ascii=False,
)


def main() -> None:
    assert detect_task_from_keywords("帮我写一个客户续费 HTML 邮件", "") == "html_email"
    assert detect_task_from_keywords("生成一个基础 HTML 网页分析稿", "") == "web_report_html"

    assert ENGINE_OUTPUT_CONTRACTS["html_email"]["validator"] == "html_email_artifact"
    assert ENGINE_OUTPUT_CONTRACTS["web_report_html"]["validator"] == "web_report_artifact"

    template = DiagramTemplate(
        tenant_id="local",
        team_id="marketing",
        name="客户活动邀请邮件模板",
        description="面向客户活动邀约的标准 HTML 邮件结构。",
        engine_type="html_email",
        task_type="html_email",
        priority=80,
        tags_json=["邮件", "活动邀请", "客户沟通"],
        template_code=EMAIL_TEMPLATE_CODE,
        metadata_json={"artifact_family": "office", "artifact_type": "html_email"},
    )
    serialized_template = serialize_diagram_template(template, include_code=True)
    assert serialized_template["artifact_family"] == "office", serialized_template
    template_prompt = format_knowledge_context(
        {
            "memory_context": {
                "knowledge": {
                    "selected_template": serialized_template,
                }
            }
        }
    )
    assert "GOVERNED ARTIFACT TEMPLATE" in template_prompt, template_prompt
    assert "GOVERNED DIAGRAM TEMPLATE" not in template_prompt, template_prompt
    assert "客户活动邀请邮件模板" in template_prompt, template_prompt
    assert "artifact_type" in template_prompt and "html_email" in template_prompt, template_prompt

    preferences = sanitize_diagram_preferences(
        {
            "artifact_preferences": {
                "html_email": {
                    "tone": "warm",
                    "brand_color": "#0f766e",
                    "language": "zh-CN",
                    "unsupported": "<script>",
                },
                "web_report_html": {
                    "tone": "analytical",
                    "brand_color": "#7c3aed",
                    "layout_density": "compact",
                    "include_summary": True,
                },
                "unknown_artifact": {"brand_color": "#000000"},
            }
        }
    )
    assert "unknown_artifact" not in preferences["artifact_preferences"], preferences
    preference_prompt = format_long_term_preferences_for_prompt({"status": "loaded", "preferences": preferences})
    assert "AUTHORIZED LONG-TERM ARTIFACT PREFERENCES" in preference_prompt, preference_prompt
    assert "html_email" in preference_prompt and "#0f766e" in preference_prompt, preference_prompt

    email_json = json.dumps(EMAIL_ARTIFACT, ensure_ascii=False)
    report_json = json.dumps(REPORT_ARTIFACT, ensure_ascii=False)
    email_validation = validate_output("html_email", email_json)
    report_validation = validate_output("web_report_html", report_json)
    assert email_validation["ok"], email_validation
    assert report_validation["ok"], report_validation

    unsafe = {
        **EMAIL_ARTIFACT,
        "sections": [{"type": "cta", "label": "unsafe", "href": "javascript:alert(1)"}],
    }
    unsafe_validation = validate_output("html_email", json.dumps(unsafe, ensure_ascii=False))
    assert not unsafe_validation["ok"], unsafe_validation
    protocol_relative = {
        **EMAIL_ARTIFACT,
        "sections": [{"type": "cta", "label": "unsafe", "href": "//example.com"}],
    }
    protocol_relative_validation = validate_output("html_email", json.dumps(protocol_relative, ensure_ascii=False))
    assert not protocol_relative_validation["ok"], protocol_relative_validation

    repair = repair_output("html_email", json.dumps({"title": "无结构邮件"}, ensure_ascii=False))
    assert repair["ok"], repair
    assert repair["repaired"], repair

    email_without_style = {
        "artifact_type": "html_email",
        "title": "偏好测试邮件",
        "email": {"subject": "偏好测试"},
        "sections": [{"type": "hero", "heading": "欢迎", "body": "测试偏好注入。"}],
    }
    designed_email, email_rules, email_status = optimize_diagram_design(
        "html_email",
        json.dumps(email_without_style, ensure_ascii=False),
        preferences,
    )
    assert email_status == "optimized", (designed_email, email_rules, email_status)
    designed_email_payload = json.loads(designed_email)
    assert designed_email_payload["style"]["brand_color"] == "#0f766e", designed_email_payload
    assert designed_email_payload["tone"] == "warm", designed_email_payload
    assert designed_email_payload["language"] == "zh-CN", designed_email_payload

    designed_report, report_rules, report_status = optimize_diagram_design(
        "web_report_html",
        report_json,
        preferences,
    )
    assert report_status == "optimized", (designed_report, report_rules, report_status)
    designed_report_payload = json.loads(designed_report)
    assert designed_report_payload["style"]["brand_color"] == "#7c3aed", designed_report_payload
    assert designed_report_payload["style"]["layout_density"] == "compact", designed_report_payload
    assert designed_report_payload["style"]["max_width"] == 760, designed_report_payload
    assert any(
        str(section.get("heading", "")).lower() == "executive summary"
        for section in designed_report_payload["sections"]
        if isinstance(section, dict)
    ), designed_report_payload

    rendered_email = render_html_artifact(EMAIL_ARTIFACT)
    rendered_rich_email = render_html_artifact(RICH_EMAIL_ARTIFACT)
    rendered_blueprint_email = render_html_artifact(BLUEPRINT_EMAIL_ARTIFACT)
    rendered_report = render_html_artifact(REPORT_ARTIFACT)
    assert "<html" in rendered_email["html"].lower()
    assert "<script" not in rendered_email["html"].lower()
    assert 'role="presentation"' in rendered_email["html"]
    assert rendered_email["metadata"]["subject"] == "续费提醒与服务权益说明"
    assert rendered_email["metadata"]["template"] == "executive_brief"
    assert len(rendered_email["metadata"]["available_templates"]) >= 4
    assert rendered_rich_email["metadata"]["template"] == "newsletter_update"
    assert "<style" not in rendered_rich_email["html"].lower()
    assert "36%" in rendered_rich_email["html"] and "+8%" in rendered_rich_email["html"], rendered_rich_email["html"]
    assert 'width="84%"' in rendered_rich_email["html"], rendered_rich_email["html"]
    assert "传统邮件" in rendered_rich_email["html"] and "结构化邮件" in rendered_rich_email["html"], rendered_rich_email["html"]
    assert rendered_blueprint_email["metadata"]["template"] == "blueprint_review"
    assert "BLUEPRINT REVIEW 2025" in rendered_blueprint_email["html"], rendered_blueprint_email["html"]
    assert "background:#f5f5f7" in rendered_blueprint_email["html"], rendered_blueprint_email["html"]
    assert "border-radius:16px" in rendered_blueprint_email["html"], rendered_blueprint_email["html"]
    assert "进行中" in rendered_blueprint_email["html"] and "#eaf6ff" in rendered_blueprint_email["html"], rendered_blueprint_email["html"]
    assert "待办" in rendered_blueprint_email["html"], rendered_blueprint_email["html"]
    assert "<style" not in rendered_blueprint_email["html"].lower()
    assert "竞品对比分析" in rendered_report["html"]

    template_html: dict[str, str] = {}
    for option in EMAIL_TEMPLATE_OPTIONS:
        template_payload = {**EMAIL_ARTIFACT, "template": option["id"]}
        rendered_template = render_html_artifact(template_payload)
        assert rendered_template["metadata"]["template"] == option["id"], rendered_template["metadata"]
        assert "续费提醒与服务权益说明" in rendered_template["html"], option
        assert 'role="presentation"' in rendered_template["html"], option
        assert "<style" not in rendered_template["html"].lower(), option
        template_html[option["id"]] = rendered_template["html"]
    assert len(set(template_html.values())) == len(EMAIL_TEMPLATE_OPTIONS), "email templates should produce distinct HTML skins"

    numbered_payload = {
        **EMAIL_ARTIFACT,
        "sections": [
            {"type": "hero", "heading": "编号清理", "body": "模型可能已经输出了编号。"},
            {"type": "list", "heading": "步骤", "items": ["1. 顾问式提问", "2）受众分析", "3、结构生成"]},
        ],
    }
    numbered_html = render_html_artifact(numbered_payload)["html"]
    assert "1. 顾问式提问" not in numbered_html, numbered_html
    assert "2）受众分析" not in numbered_html, numbered_html
    assert "3、结构生成" not in numbered_html, numbered_html
    assert ">1.<" not in numbered_html and ">2.<" not in numbered_html, numbered_html
    assert "顾问式提问" in numbered_html and "受众分析" in numbered_html, numbered_html

    version = DiagramVersion(
        tenant_id="local",
        diagram_id="diagram-office-smoke",
        engine_type="html_email",
        task_type="html_email",
        code=email_json,
        design_concept="Office artifact smoke",
    )
    version.id = "version-office-smoke"
    export_result = render_result_for_format("diagram-office-smoke", version, "html")
    assert export_result["mime_type"].startswith("text/html"), export_result
    assert export_result["extension"] == "html", export_result
    try:
        render_result_for_format("diagram-office-smoke", version, "pptx")
    except RenderUnsupported:
        pass
    else:
        raise AssertionError("Office artifact PPTX export should be rejected until a renderer exists")

    print("OK: office artifact renderers passed")


if __name__ == "__main__":
    main()
