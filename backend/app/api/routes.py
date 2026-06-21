"""
API routes for SmartDiagram.
Includes SSE streaming endpoint for chat with agents.
Supports multi-turn conversation and incremental editing.
"""

import json
import hashlib
import re
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from app.agents.orchestrator import graph
from app.agents.catalog import get_task_for_engine
from app.artifacts.catalog import is_office_artifact
from app.agents.drawio_agent import sanitize_drawio_xml
from app.core.db import async_session
from app.core.llm import extract_text_content
from app.core.logger import logger
from app.models.audit import AuditEvent
from app.services.agent_runtime import (
    build_default_execution_plan,
    steps_to_events,
)
from app.services.human_approval_service import (
    create_human_approval_request,
    serialize_approval_request,
)
from app.services.agent_trace_service import AgentTraceRecorder
from app.services.audit_service import (
    create_agent_run_id,
    persist_agent_run_finish,
    persist_agent_run_start,
)
from app.services.diagram_persistence_service import (
    create_conversation_id,
    persist_generated_diagram,
)
from app.services.conversation_memory_service import (
    format_conversation_memory_for_prompt,
    load_conversation_memory,
)
from app.services.long_term_memory_service import load_long_term_preferences
from app.services.budget_service import evaluate_tenant_budget
from app.services.mermaid_sanitizer import normalize_mermaid_code
from app.services.output_validation import validate_output
from app.services.permission_service import build_permission_context
from app.services.runtime_guard_service import (
    RuntimeGuardError,
    RuntimeRateLimitBackendError,
    StreamLoopGuard,
    evaluate_runtime_request_async,
)

router = APIRouter()


def normalize_generated_code(engine_type: str | None, content: str) -> str:
    """Apply deterministic source normalization before streaming or saving."""

    if engine_type == "drawio":
        return sanitize_drawio_xml(content)
    if engine_type == "mermaid":
        normalized, _ = normalize_mermaid_code(content)
        return normalized
    return content


class StreamingTagParser:
    """
    Parse XML-style <design_concept>, <code> tags, or markdown code blocks (```json / ```)
    from streaming LLM output. Emits SSE events as content is received.

    For <code> blocks, performs incremental JSON object extraction
    for real-time rendering of diagram elements.
    """

    def __init__(self):
        self.buffer = ""
        self.in_design = False
        self.in_code = False
        self.code_delimiters = ["<code>", "```json", "```xml", "```mermaid", "```"]
        self.code_end_delimiters = ["</code>", "```"]
        # Raw XML mode for Draw.io (mxfile is part of code content, not a wrapper)
        self._is_raw_xml = False
        # Incremental JSON extraction state
        self._code_buffer = ""
        self._raw_code = ""  # Full raw code text for canvasCode
        self._brace_depth = 0
        self._in_string = False
        self._escape_next = False
        self._obj_start = -1

    def _extract_objects(self) -> list[dict]:
        """Extract complete JSON objects from the code buffer using brace counting.

        Scans character by character, tracking brace depth and string state.
        When a top-level {...} is fully closed, emits it as an 'element' event.
        State is LOCAL to each call — we always re-scan from the start of _code_buffer.
        """
        events = []
        brace_depth = 0
        in_string = False
        escape_next = False
        obj_start = -1
        i = 0

        while i < len(self._code_buffer):
            ch = self._code_buffer[i]

            if escape_next:
                escape_next = False
                i += 1
                continue

            if ch == '\\' and in_string:
                escape_next = True
                i += 1
                continue

            if ch == '"' and not escape_next:
                in_string = not in_string
                i += 1
                continue

            if in_string:
                i += 1
                continue

            # Outside strings: track braces
            if ch == '{':
                if brace_depth == 0:
                    obj_start = i
                brace_depth += 1
            elif ch == '}':
                brace_depth -= 1
                if brace_depth == 0 and obj_start >= 0:
                    # Complete object found!
                    obj_str = self._code_buffer[obj_start:i + 1]
                    try:
                        obj = json.loads(obj_str)
                        events.append({"type": "element", "content": obj})
                    except json.JSONDecodeError:
                        pass  # Skip malformed objects
                    obj_start = -1
                    # Consume everything up to and including this object
                    self._code_buffer = self._code_buffer[i + 1:]
                    # Restart scan from beginning
                    i = 0
                    brace_depth = 0
                    in_string = False
                    escape_next = False
                    obj_start = -1
                    continue

            i += 1

        return events

    def feed(self, chunk: str) -> list[dict]:
        """Feed a chunk of text and return parsed SSE events."""
        events = []
        self.buffer += chunk

        while True:
            if not self.in_design and not self.in_code:
                # Look for opening tags
                design_match = self.buffer.find("<design_concept>")
                
                # Find first occurring code delimiter
                code_match = -1
                matched_delim = ""
                for delim in self.code_delimiters:
                    pos = self.buffer.find(delim)
                    if pos != -1:
                        if code_match == -1 or pos < code_match:
                            code_match = pos
                            matched_delim = delim

                # Also check for raw mxfile XML (Draw.io outputs <mxfile...> directly)
                mxfile_match = self.buffer.find("<mxfile")

                if design_match != -1 and (code_match == -1 or design_match < code_match) and (mxfile_match == -1 or design_match < mxfile_match):
                    self.buffer = self.buffer[design_match + len("<design_concept>"):]
                    self.in_design = True
                    events.append({"type": "design_start"})
                    continue
                elif mxfile_match != -1 and (code_match == -1 or mxfile_match < code_match):
                    # Raw XML mode: <mxfile is part of the code content, not stripped
                    self.in_code = True
                    self._is_raw_xml = True
                    self._code_buffer = ""
                    self._raw_code = self.buffer[mxfile_match:mxfile_match + len("<mxfile")]
                    self.buffer = self.buffer[mxfile_match + len("<mxfile"):]
                    self._brace_depth = 0
                    self._in_string = False
                    self._escape_next = False
                    self._obj_start = -1
                    events.append({"type": "code_start"})
                    continue
                elif code_match != -1:
                    self.buffer = self.buffer[code_match + len(matched_delim):]
                    self.in_code = True
                    self._is_raw_xml = False
                    # Reset code extraction state
                    self._code_buffer = ""
                    self._raw_code = ""
                    self._brace_depth = 0
                    self._in_string = False
                    self._escape_next = False
                    self._obj_start = -1
                    events.append({"type": "code_start"})
                    continue
                else:
                    # No tags found — emit plain text incrementally
                    # Keep a safety margin in case a tag is being streamed in
                    safe_len = max(0, len(self.buffer) - 30)
                    if safe_len > 0:
                        events.append({"type": "text", "content": self.buffer[:safe_len]})
                        self.buffer = self.buffer[safe_len:]
                    break

            elif self.in_design:
                end_idx = self.buffer.find("</design_concept>")
                
                # Find first occurring code delimiter
                code_idx = -1
                for delim in self.code_delimiters:
                    pos = self.buffer.find(delim)
                    if pos != -1:
                        if code_idx == -1 or pos < code_idx:
                            code_idx = pos

                # Also check for raw mxfile in design (LLM might skip </design_concept>)
                mxfile_idx = self.buffer.find("<mxfile")
                if mxfile_idx != -1 and (code_idx == -1 or mxfile_idx < code_idx):
                    code_idx = mxfile_idx

                # If code starts before design ends (or design never closes)
                if code_idx != -1 and (end_idx == -1 or code_idx < end_idx):
                    content = self.buffer[:code_idx]
                    self.buffer = self.buffer[code_idx:]  # Leave code delimiter in buffer
                    self.in_design = False
                    if content.strip():
                        events.append({"type": "design", "content": content.strip()})
                    events.append({"type": "design_end"})
                    continue
                elif end_idx != -1:
                    content = self.buffer[:end_idx]
                    self.buffer = self.buffer[end_idx + len("</design_concept>"):]
                    self.in_design = False
                    if content:
                        events.append({"type": "design", "content": content})
                    events.append({"type": "design_end"})
                    continue
                else:
                    safe_len = max(0, len(self.buffer) - 20)
                    if safe_len > 0:
                        events.append({"type": "design", "content": self.buffer[:safe_len]})
                        self.buffer = self.buffer[safe_len:]
                    break

            elif self.in_code:
                if self._is_raw_xml:
                    # Raw XML mode: look for </mxfile> as end (include it in content)
                    end_idx = self.buffer.find("</mxfile>")
                    if end_idx != -1:
                        # Include </mxfile> in the code content
                        remaining = self.buffer[:end_idx + len("</mxfile>")]
                        self._raw_code += remaining
                        self.buffer = self.buffer[end_idx + len("</mxfile>"):]
                        events.append({"type": "code_complete", "content": self._raw_code.strip()})
                        events.append({"type": "code_end"})
                        self.in_code = False
                        self._is_raw_xml = False
                        continue
                    else:
                        # Stream incrementally, keep margin for </mxfile>
                        safe_len = max(0, len(self.buffer) - 15)
                        if safe_len > 0:
                            new_content = self.buffer[:safe_len]
                            self._raw_code += new_content
                            events.append({"type": "code", "content": new_content})
                            self.buffer = self.buffer[safe_len:]
                        break
                else:
                    # Standard code mode: look for </code> or ```
                    end_idx = -1
                    matched_end_delim = ""
                    for delim in self.code_end_delimiters:
                        pos = self.buffer.find(delim)
                        if pos != -1:
                            if end_idx == -1 or pos < end_idx:
                                end_idx = pos
                                matched_end_delim = delim

                    if end_idx != -1:
                        remaining = self.buffer[:end_idx]
                        self._code_buffer += remaining
                        self._raw_code += remaining

                        # Extract remaining JSON objects
                        element_events = self._extract_objects()
                        events.extend(element_events)

                        # Send full raw code for canvasCode store
                        events.append({"type": "code_complete", "content": self._raw_code.strip()})
                        events.append({"type": "code_end"})
                        self.buffer = self.buffer[end_idx + len(matched_end_delim):]
                        self.in_code = False
                        continue
                    else:
                        # Push buffer content to code buffer, keep a safety margin for delimiters
                        safe_len = max(0, len(self.buffer) - 10)
                        if safe_len > 0:
                            new_content = self.buffer[:safe_len]
                            self._code_buffer += new_content
                            self._raw_code += new_content

                            # Extract complete JSON objects
                            element_events = self._extract_objects()
                            events.extend(element_events)
                            events.append({"type": "code", "content": new_content})

                            self.buffer = self.buffer[safe_len:]
                        break

        return events

    def flush(self) -> list[dict]:
        """Flush remaining buffer content."""
        events = []
        remaining = self.buffer.strip()

        if self.in_design:
            # Check if there's code hidden in the remaining design content
            code_idx = -1
            matched_delim = ""
            for delim in self.code_delimiters:
                pos = remaining.find(delim)
                if pos != -1:
                    if code_idx == -1 or pos < code_idx:
                        code_idx = pos
                        matched_delim = delim

            # Also check for raw mxfile
            mxfile_idx = remaining.find("<mxfile")
            if mxfile_idx != -1 and (code_idx == -1 or mxfile_idx < code_idx):
                code_idx = mxfile_idx
                matched_delim = "<mxfile"

            if code_idx != -1:
                design_part = remaining[:code_idx].strip()
                if design_part:
                    events.append({"type": "design", "content": design_part})
                events.append({"type": "design_end"})
                
                # Extract code content
                if matched_delim == "<mxfile":
                    # Raw XML: include <mxfile in content, end at </mxfile>
                    code_content = remaining[code_idx:]
                    mxfile_end = code_content.find("</mxfile>")
                    if mxfile_end != -1:
                        code_content = code_content[:mxfile_end + len("</mxfile>")]
                else:
                    code_content = remaining[code_idx + len(matched_delim):]
                    # Look for end delimiters
                    code_end_idx = -1
                    for delim in self.code_end_delimiters:
                        pos = code_content.find(delim)
                        if pos != -1:
                            if code_end_idx == -1 or pos < code_end_idx:
                                code_end_idx = pos
                    if code_end_idx != -1:
                        code_content = code_content[:code_end_idx]

                events.append({"type": "code_start"})
                events.append({"type": "code_complete", "content": code_content.strip()})
                events.append({"type": "code_end"})
            elif remaining:
                events.append({"type": "design", "content": remaining})
                events.append({"type": "design_end"})
        elif self.in_code:
            if self._is_raw_xml:
                # Include any remaining content (might include </mxfile>)
                if "</mxfile>" in remaining:
                    end_idx = remaining.find("</mxfile>")
                    remaining = remaining[:end_idx + len("</mxfile>")]
                self._raw_code += remaining
                if self._raw_code.strip():
                    events.append({"type": "code_complete", "content": self._raw_code.strip()})
                events.append({"type": "code_end"})
            else:
                # Strip any trailing code end delimiters from remaining
                for delim in self.code_end_delimiters:
                    if remaining.endswith(delim):
                        remaining = remaining[:-len(delim)].strip()
                
                if remaining:
                    self._code_buffer += remaining
                    self._raw_code += remaining
                # Final extraction attempt
                element_events = self._extract_objects()
                events.extend(element_events)
                if self._raw_code.strip():
                    events.append({"type": "code_complete", "content": self._raw_code.strip()})
                events.append({"type": "code_end"})
        elif remaining:
            # Check for raw mxfile in plain text (no design_concept wrapper)
            mxfile_idx = remaining.find("<mxfile")
            if mxfile_idx != -1:
                pre_text = remaining[:mxfile_idx].strip()
                if pre_text:
                    events.append({"type": "text", "content": pre_text})
                code_content = remaining[mxfile_idx:]
                mxfile_end = code_content.find("</mxfile>")
                if mxfile_end != -1:
                    code_content = code_content[:mxfile_end + len("</mxfile>")]
                events.append({"type": "code_start"})
                events.append({"type": "code_complete", "content": code_content.strip()})
                events.append({"type": "code_end"})
            else:
                # Plain text without any XML tags (e.g. general agent conversation)
                events.append({"type": "text", "content": remaining})

        self.buffer = ""
        return events



def _build_messages(body: dict, conversation_memory_prompt: str = "") -> list:
    """Build LangChain message sequence from request body.

    Supports:
      - body["message"] — current user message (required)
      - body["images"] — list of base64 data-URL strings for vision (optional)
      - body["history"] — previous conversation turns (optional)

    Returns a list like [HumanMessage, AIMessage, ..., HumanMessage].
    """
    messages = []
    if conversation_memory_prompt:
        messages.append(SystemMessage(content=conversation_memory_prompt))

    # Reconstruct history
    history = body.get("history") or []
    for msg in history:
        role = msg.get("role", "")
        content = msg.get("content", "")
        if not content:
            continue
        if role == "user":
            messages.append(HumanMessage(content=content))
        elif role == "assistant":
            messages.append(AIMessage(content=content))

    # Append current user message
    user_message = body.get("message", "").strip()

    # Apply diagram length / detail level controls
    detail_level = body.get("detailLevel") or body.get("detail_level")
    if detail_level == "short":
        user_message += "\n\n[System Instruction: Please make the generated diagram highly concise. LIMIT the output to only the core 4 to 6 essential nodes/steps, skipping any detailed validation steps, error handling, or minor branch details.]"
    elif detail_level == "long":
        user_message += "\n\n[System Instruction: Please make the generated diagram highly detailed and comprehensive. EXPAND fully on edge cases, error handling steps, validation logic, timeouts, and all potential scenarios, aiming for 15+ nodes/steps to cover everything.]"
    elif detail_level == "medium":
        user_message += "\n\n[System Instruction: Please make the generated diagram standard in detail, containing around 8 to 12 nodes/steps. Focus on primary flows and main decisions.]"

    # If there's existing canvas code and the user wants to edit,
    # inject it so the Agent knows the current state.
    current_code = body.get("current_code", "")
    current_engine = body.get("current_engine") or ""
    design_concept = body.get("design_concept") or ""

    if current_code:
        # Detect cross-engine type switching via @agent prefix in message
        target_engine = ""
        msg_text = body.get("message", "")
        if msg_text.startswith("@"):
            at_end = msg_text.find(" ")
            if at_end > 0:
                target_engine = msg_text[1:at_end].strip()

        is_cross_engine = bool(
            current_engine
            and target_engine
            and current_engine != target_engine
        )

        if is_cross_engine and design_concept:
            # Cross-engine type switch: inject semantic context so the LLM
            # understands the CONTENT of the original diagram, not its code format.
            labels = re.findall(r'"label"\s*:\s*"([^"]{2,80})"', current_code)
            label_summary = "、".join(labels[:20]) if labels else ""
            user_message += (
                f"\n\n<source_diagram>"
                f"\n[IMPORTANT] This is a TYPE CONVERSION. The user wants to PRESERVE the original "
                f"business content and restructure it into a different diagram format."
                f"\n\nOriginal diagram engine: {current_engine}"
                f"\nOriginal design concept:\n{design_concept[:1500]}"
            )
            if label_summary:
                user_message += f"\nOriginal key nodes/labels: {label_summary}"
            user_message += (
                f"\n\nYou MUST base your output on the above content. "
                f"Do NOT invent new business scenarios. "
                f"Restructure the SAME content into {target_engine} format."
                f"\n</source_diagram>"
                f"\n\n<existing_code>\n{current_code}\n</existing_code>"
            )
        else:
            # Same-engine edit: pass code directly
            user_message += f"\n\n<existing_code>\n{current_code}\n</existing_code>"

    # Build multimodal message if images are present
    images = body.get("images") or []
    if images:
        content = [{"type": "text", "text": user_message}]
        for img_data in images:
            content.append({"type": "image_url", "image_url": {"url": img_data}})
        messages.append(HumanMessage(content=content))
    else:
        messages.append(HumanMessage(content=user_message))
    return messages


def _build_knowledge_context_event(output: dict) -> dict | None:
    """Build a sanitized SSE event for Knowledge Agent retrieval results."""

    knowledge = (output.get("memory_context") or {}).get("knowledge") or {}
    if not knowledge:
        return None

    selected_template = knowledge.get("selected_template") or {}
    historical_diagrams = knowledge.get("historical_diagrams") or []
    citations = knowledge.get("citations") or []
    safe_citations = []
    for citation in citations[:5]:
        if not isinstance(citation, dict):
            continue
        safe_citations.append(
            {
                "source_id": citation.get("source_id"),
                "document_id": citation.get("document_id"),
                "source_locator": citation.get("source_locator", ""),
            }
        )

    return {
        "type": "knowledge_context",
        "status": knowledge.get("status", "unknown"),
        "count": len(knowledge.get("chunks") or []),
        "citations": safe_citations,
        "historical_diagrams": [
            {
                "diagram_id": item.get("diagram_id"),
                "title": item.get("title"),
                "engine_type": item.get("engine_type"),
                "task_type": item.get("task_type"),
                "current_version_id": item.get("current_version_id"),
            }
            for item in historical_diagrams[:3]
            if isinstance(item, dict)
        ],
        "selected_template": {
            "template_id": selected_template.get("template_id"),
            "name": selected_template.get("name"),
            "engine_type": selected_template.get("engine_type"),
            "task_type": selected_template.get("task_type"),
            "match_score": selected_template.get("match_score"),
        } if selected_template else None,
        "note": knowledge.get("note", ""),
    }


def _build_conversation_memory_event(memory: dict) -> dict | None:
    """Build a sanitized SSE event for persisted short-term memory."""

    if not memory:
        return None
    context = memory.get("context") or {}
    short_term_memory = context.get("short_term_memory") or {}
    return {
        "type": "conversation_memory",
        "status": memory.get("status", "empty"),
        "reason": memory.get("reason", ""),
        "summary_present": bool(memory.get("summary")),
        "recent_count": len(memory.get("recent_messages") or []),
        "turn_count": short_term_memory.get("turn_count") or 0,
        "current_diagram_version_id": (
            memory.get("current_diagram_version_id")
            or context.get("current_diagram_version_id")
            or ""
        ),
    }


def _build_long_term_preferences_event(memory: dict) -> dict | None:
    """Build a sanitized SSE event for long-term artifact preferences."""

    if not memory:
        return None
    preferences = memory.get("preferences") or {}
    return {
        "type": "long_term_preferences",
        "status": memory.get("status", "empty"),
        "reason": memory.get("reason", ""),
        "sources": memory.get("sources", {}),
        "keys": sorted(preferences.keys()),
    }


def _build_planner_event(output: dict) -> dict | None:
    """Build a sanitized SSE event for Planner Agent results."""

    planning = (output.get("memory_context") or {}).get("planning") or {}
    if not planning:
        return None
    subtasks = planning.get("subtasks") or []
    safe_subtasks = []
    for subtask in subtasks[:8]:
        if not isinstance(subtask, dict):
            continue
        safe_subtasks.append(
            {
                "id": subtask.get("id", ""),
                "label": subtask.get("label", ""),
                "owner": subtask.get("owner", ""),
                "required": bool(subtask.get("required", False)),
            }
        )
    return {
        "type": "planner_plan",
        "status": planning.get("status", "unknown"),
        "mode": planning.get("mode", ""),
        "complexity": planning.get("complexity", ""),
        "task_type": planning.get("task_type", ""),
        "engine_type": planning.get("engine_type", ""),
        "knowledge_required": bool(planning.get("knowledge_required")),
        "subtasks": safe_subtasks,
        "quality_gates": planning.get("quality_gates", []),
        "assumptions": planning.get("assumptions", []),
        "note": planning.get("note", ""),
    }


def _build_design_agent_event(output: dict) -> dict | None:
    """Build a sanitized SSE event for Design Agent results."""

    design = (output.get("memory_context") or {}).get("design") or {}
    if not design:
        return None
    return {
        "type": "design_agent",
        "status": design.get("status", "unknown"),
        "engine_type": design.get("engine_type", ""),
        "changed": bool(design.get("changed")),
        "applied_rules": design.get("applied_rules", []),
        "note": design.get("note", ""),
    }


def _build_export_plan_event(output: dict) -> dict | None:
    """Build a sanitized SSE event for Export Agent planning results."""

    export_plan = (output.get("memory_context") or {}).get("export") or {}
    if not export_plan:
        return None
    return {
        "type": "export_plan",
        "status": export_plan.get("status", "unknown"),
        "engine_type": export_plan.get("engine_type", ""),
        "preferred_format": export_plan.get("preferred_format", ""),
        "allowed_formats": export_plan.get("allowed_formats", []),
        "denied_formats": export_plan.get("denied_formats", []),
        "note": export_plan.get("note", ""),
    }


def _build_validator_event(output: dict) -> dict | None:
    """Build a sanitized SSE event for Validator Agent results."""

    validation = (output.get("memory_context") or {}).get("validation") or {}
    result = validation.get("result") or {}
    if not result:
        return None
    return {
        "type": "validation_agent",
        "status": validation.get("status", "unknown"),
        "ok": bool(result.get("ok")),
        "engine_type": result.get("engine_type", ""),
        "errors": result.get("errors", []),
        "warnings": result.get("warnings", []),
        "repairable": bool(result.get("repairable")),
    }


def _build_repair_event(output: dict) -> dict | None:
    """Build a sanitized SSE event for Repair Agent results."""

    repair = (output.get("memory_context") or {}).get("repair") or {}
    if not repair:
        return None
    validation = repair.get("validation") or {}
    return {
        "type": "repair_agent",
        "status": repair.get("status", "unknown"),
        "engine_type": repair.get("engine_type", ""),
        "repaired": bool(repair.get("repaired")),
        "applied_rules": repair.get("applied_rules", []),
        "errors": repair.get("errors", []),
        "validation_ok": bool(validation.get("ok")),
        "note": repair.get("note", ""),
    }


def _build_consistency_event(output: dict) -> dict | None:
    """Build a sanitized SSE event for Consistency Agent results."""

    consistency = (output.get("memory_context") or {}).get("consistency") or {}
    if not consistency:
        return None
    return {
        "type": "consistency_agent",
        "status": consistency.get("status", "unknown"),
        "ok": bool(consistency.get("ok", True)),
        "needs_user_input": bool(consistency.get("needs_user_input", False)),
        "checked_chunks": int(consistency.get("checked_chunks") or 0),
        "missing_required_terms": consistency.get("missing_required_terms", []),
        "forbidden_terms_present": consistency.get("forbidden_terms_present", []),
        "coverage_ratio": consistency.get("coverage_ratio", 1.0),
        "note": consistency.get("note", ""),
    }


@router.post("/chat/stream")
async def chat_stream(request: Request):
    """SSE endpoint: streams agent response as design_concept + code events.

    Accepts:
      - message: str (required)
      - history: list[{role, content}] (optional)
      - current_code: str (optional) — canvas code for incremental editing
      - current_task: str (optional) — which task category is active on canvas
      - current_engine: str (optional) — which engine is active on canvas
      - model_config: dict (optional)
    """
    body = await request.json()
    user_message = body.get("message", "")

    if not user_message:
        return {"error": "message is required"}

    permission_context = build_permission_context(body)
    try:
        runtime_guard = await evaluate_runtime_request_async(body, permission_context)
    except RuntimeRateLimitBackendError as exc:
        logger.warning(f"Runtime rate-limit backend unavailable: {exc}")
        raise HTTPException(
            status_code=503,
            detail={"reason": "rate_limit_backend_unavailable"},
        ) from exc
    if not runtime_guard["allowed"]:
        if runtime_guard["reason"] == "rate_limited":
            raise HTTPException(
                status_code=429,
                detail={
                    "reason": runtime_guard["reason"],
                    "retry_after_seconds": runtime_guard["retry_after_seconds"],
                },
            )
        raise HTTPException(status_code=413, detail={"reason": runtime_guard["reason"]})
    if runtime_guard["degraded"] and not (body.get("detailLevel") or body.get("detail_level")):
        body["detailLevel"] = "short"

    budget_guard = {
        "allowed": True,
        "reason": "budget_check_unavailable",
        "period": "",
        "tenant_id": permission_context.get("tenant_id") or "local",
    }
    try:
        async with async_session() as session:
            budget_guard = await evaluate_tenant_budget(
                session,
                permission_context,
                runtime_guard,
            )
            if not budget_guard["allowed"]:
                session.add(
                    AuditEvent(
                        tenant_id=permission_context.get("tenant_id") or "local",
                        project_id=permission_context.get("project_id"),
                        user_id=permission_context.get("user_id") or "anonymous",
                        event_type="tenant.budget.rejected",
                        severity="warning",
                        message="Request rejected by tenant monthly budget.",
                        metadata_json=budget_guard,
                    )
                )
                await session.commit()
                raise HTTPException(status_code=402, detail=budget_guard)
            await session.commit()
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning(f"Tenant budget check skipped: {exc}")

    async def event_generator():
        parser = StreamingTagParser()
        current_engine_name = ""  # Track which engine is active
        current_task_name = ""    # Track which task is active
        llm_ended = False        # Track if LLM step has ended
        in_router = False        # Track if currently executing the router chain
        execution_plan_sent = False
        execution_plan_events = []
        validation_events = []
        audit_event_buffer = []
        tool_call_buffer = []
        design_code_override = ""
        repair_code_override = ""
        consistency_needs_user_input = False
        consistency_event_payload = None
        stream_status = "succeeded"
        stream_error = ""
        design_buffer = ""
        latest_code = ""
        assistant_content = ""

        current_engine = body.get("current_engine") or body.get("current_agent", "")
        current_task = body.get("current_task") or get_task_for_engine(current_engine)
        conversation_id = body.get("conversation_id") or body.get("conversationId") or create_conversation_id()
        current_diagram_id = body.get("current_diagram_id") or body.get("currentDiagramId")
        conversation_memory = {}
        conversation_memory_prompt = ""
        long_term_preferences = {}
        try:
            async with async_session() as session:
                conversation_memory = await load_conversation_memory(
                    session,
                    permission_context=permission_context,
                    conversation_id=conversation_id,
                )
                conversation_memory_prompt = format_conversation_memory_for_prompt(conversation_memory)
                long_term_preferences = await load_long_term_preferences(
                    session,
                    permission_context=permission_context,
                )
        except Exception as exc:
            logger.warning(f"Memory load skipped: {exc}")
            if not conversation_memory:
                conversation_memory = {
                    "status": "unavailable",
                    "reason": "load_failed",
                    "recent_messages": [],
                }
            if not long_term_preferences:
                long_term_preferences = {
                    "status": "unavailable",
                    "reason": "load_failed",
                    "preferences": {},
                }

        # Build multi-turn message sequence after persisted memory has been loaded.
        messages = _build_messages(body, conversation_memory_prompt=conversation_memory_prompt)

        run_id = create_agent_run_id()
        loop_guard = StreamLoopGuard()
        trace_recorder = AgentTraceRecorder(
            run_id=run_id,
            permission_context=permission_context,
            conversation_id=conversation_id,
        )
        await persist_agent_run_start(
            run_id=run_id,
            permission_context=permission_context,
            model_config=body.get("model_config"),
            conversation_id=conversation_id,
            token_usage={
                "estimated_input_tokens": runtime_guard["estimated_input_tokens"],
                "estimated_output_tokens": runtime_guard["estimated_output_tokens"],
                "estimated_total_tokens": runtime_guard["estimated_total_tokens"],
            },
            cost_estimate=runtime_guard["estimated_cost"],
        )

        input_state = {
            "messages": messages,
            "intent": "",
            "task_type": "",
            "engine_type": "",
            "model_config": body.get("model_config"),
            "current_code": body.get("current_code", ""),
            "current_task": current_task,
            "current_engine": current_engine,
            "tenant_id": permission_context.get("tenant_id", ""),
            "user_id": permission_context.get("user_id", ""),
            "team_id": permission_context.get("team_id", ""),
            "project_id": permission_context.get("project_id", ""),
            "permission_context": permission_context,
            "run_id": run_id,
            "conversation_id": conversation_id or "",
            "memory_context": {
                "conversation": conversation_memory,
                "long_term_preferences": long_term_preferences,
            },
            "cost_estimate": runtime_guard["estimated_cost"],
        }
        audit_event_buffer.append(
            {
                "type": "runtime.guard.evaluated",
                "actor_user_id": permission_context.get("user_id"),
                "tenant_id": permission_context.get("tenant_id"),
                "project_id": permission_context.get("project_id"),
                "message": "Runtime guard evaluated request budget.",
                "metadata": {
                    "reason": runtime_guard["reason"],
                    "estimated_input_tokens": runtime_guard["estimated_input_tokens"],
                    "estimated_output_tokens": runtime_guard["estimated_output_tokens"],
                    "estimated_total_tokens": runtime_guard["estimated_total_tokens"],
                    "estimated_cost": runtime_guard["estimated_cost"],
                    "degraded": runtime_guard["degraded"],
                    "degradation_reason": runtime_guard["degradation_reason"],
                },
            }
        )
        if runtime_guard["degraded"]:
            audit_event_buffer.append(
                {
                    "type": "runtime.degraded",
                    "actor_user_id": permission_context.get("user_id"),
                    "tenant_id": permission_context.get("tenant_id"),
                    "project_id": permission_context.get("project_id"),
                    "message": "Request was degraded to concise output because estimated token usage is high.",
                    "metadata": {
                        "degradation_reason": runtime_guard["degradation_reason"],
                        "estimated_total_tokens": runtime_guard["estimated_total_tokens"],
                    },
                }
            )
        audit_event_buffer.append(
            {
                "type": "tenant.budget.evaluated",
                "actor_user_id": permission_context.get("user_id"),
                "tenant_id": permission_context.get("tenant_id"),
                "project_id": permission_context.get("project_id"),
                "message": "Tenant budget evaluated request projection.",
                "metadata": budget_guard,
            }
        )
        audit_event_buffer.append(
            {
                "type": "conversation.memory.loaded",
                "actor_user_id": permission_context.get("user_id"),
                "tenant_id": permission_context.get("tenant_id"),
                "project_id": permission_context.get("project_id"),
                "message": "Short-term conversation memory loaded for Agent context.",
                "metadata": {
                    "status": conversation_memory.get("status", "empty"),
                    "reason": conversation_memory.get("reason", ""),
                    "summary_present": bool(conversation_memory.get("summary")),
                    "recent_count": len(conversation_memory.get("recent_messages") or []),
                    "current_diagram_version_id": (
                        conversation_memory.get("current_diagram_version_id")
                        or (conversation_memory.get("context") or {}).get("current_diagram_version_id")
                        or ""
                    ),
                },
            }
        )
        audit_event_buffer.append(
            {
                "type": "preference.memory.loaded",
                "actor_user_id": permission_context.get("user_id"),
                "tenant_id": permission_context.get("tenant_id"),
                "project_id": permission_context.get("project_id"),
                "message": "Long-term artifact preferences loaded for Agent context.",
                "metadata": {
                    "status": long_term_preferences.get("status", "empty"),
                    "reason": long_term_preferences.get("reason", ""),
                    "sources": long_term_preferences.get("sources", {}),
                    "keys": sorted((long_term_preferences.get("preferences") or {}).keys()),
                },
            }
        )

        try:
            yield f"data: {json.dumps({'type': 'conversation', 'conversation_id': conversation_id}, ensure_ascii=False)}\n\n"
            yield f"data: {json.dumps({'type': 'agent_run', 'run_id': run_id}, ensure_ascii=False)}\n\n"
            yield f"data: {json.dumps({'type': 'runtime_guard', **runtime_guard}, ensure_ascii=False)}\n\n"
            yield f"data: {json.dumps({'type': 'budget_guard', **budget_guard}, ensure_ascii=False)}\n\n"
            conversation_memory_event = _build_conversation_memory_event(conversation_memory)
            if conversation_memory_event:
                yield f"data: {json.dumps(conversation_memory_event, ensure_ascii=False)}\n\n"
            preferences_event = _build_long_term_preferences_event(long_term_preferences)
            if preferences_event:
                yield f"data: {json.dumps(preferences_event, ensure_ascii=False)}\n\n"
            async for event in graph.astream_events(input_state, version="v2"):
                trace_recorder.observe_langgraph_event(event)
                loop_guard.observe_event(event)
                kind = event.get("event")
                name = event.get("name", "")

                if kind == "on_chat_model_stream":
                    chunk = event.get("data", {}).get("chunk")
                    if chunk and hasattr(chunk, "content") and chunk.content:
                        text = extract_text_content(chunk.content)
                        if text:
                            if not llm_ended:
                                llm_ended = True
                                yield f"data: {json.dumps({'type': 'status', 'step_id': 'llm', 'action': 'end'}, ensure_ascii=False)}\n\n"
                            parsed_events = parser.feed(text)
                            for pe in parsed_events:
                                if pe.get("type") == "design":
                                    design_buffer += pe.get("content", "")
                                elif pe.get("type") == "text":
                                    assistant_content += pe.get("content", "")
                                elif pe.get("type") == "code_start":
                                    generating_label = "生成办公产物" if is_office_artifact(current_engine_name) else "生成与绘制图表"
                                    yield f"data: {json.dumps({'type': 'status', 'step_id': 'generating', 'content': generating_label, 'action': 'start'}, ensure_ascii=False)}\n\n"
                                elif pe.get("type") == "code_complete":
                                    yield f"data: {json.dumps({'type': 'status', 'step_id': 'generating', 'action': 'end'}, ensure_ascii=False)}\n\n"
                                    pe["content"] = normalize_generated_code(
                                        current_engine_name,
                                        pe.get("content", ""),
                                    )
                                    latest_code = pe.get("content", "")
                                    validation = validate_output(
                                        current_engine_name,
                                        pe.get("content", ""),
                                    )
                                    validation_event = {"type": "validation", **validation}
                                    validation_events.append(validation_event)
                                    yield f"data: {json.dumps(validation_event, ensure_ascii=False)}\n\n"
                                yield f"data: {json.dumps(pe, ensure_ascii=False)}\n\n"

                elif kind == "on_chain_end" and name == "router":
                    in_router = False
                    output = event.get("data", {}).get("output", {})
                    if isinstance(output, dict):
                        route_engine = output.get("engine_type", "") or output.get("intent", "")
                        route_task = output.get("task_type", "") or get_task_for_engine(route_engine)
                        current_task_name = route_task or current_task_name
                        current_engine_name = route_engine or current_engine_name
                        if current_task_name or current_engine_name:
                            yield f"data: {json.dumps({'type': 'route', 'task': current_task_name, 'engine': current_engine_name}, ensure_ascii=False)}\n\n"
                            if not execution_plan_sent:
                                execution_plan = build_default_execution_plan(
                                    current_task_name,
                                    current_engine_name,
                                )
                                execution_plan_events = steps_to_events(execution_plan)
                                yield f"data: {json.dumps({'type': 'execution_plan', 'steps': execution_plan_events}, ensure_ascii=False)}\n\n"
                                execution_plan_sent = True
                    yield f"data: {json.dumps({'type': 'status', 'step_id': 'router', 'action': 'end'}, ensure_ascii=False)}\n\n"

                elif kind == "on_chain_end" and name == "knowledge_agent":
                    output = event.get("data", {}).get("output", {})
                    if isinstance(output, dict):
                        audit_event_buffer.extend(output.get("audit_events") or [])
                        tool_call_buffer.extend(output.get("tool_calls") or [])
                        knowledge_event = _build_knowledge_context_event(output)
                        if knowledge_event:
                            yield f"data: {json.dumps(knowledge_event, ensure_ascii=False)}\n\n"
                    yield f"data: {json.dumps({'type': 'status', 'step_id': 'knowledge', 'action': 'end'}, ensure_ascii=False)}\n\n"

                elif kind == "on_chain_end" and name == "planner_agent":
                    output = event.get("data", {}).get("output", {})
                    if isinstance(output, dict):
                        audit_event_buffer.extend(output.get("audit_events") or [])
                        tool_call_buffer.extend(output.get("tool_calls") or [])
                        if output.get("execution_plan"):
                            execution_plan_events = steps_to_events(output.get("execution_plan") or [])
                            yield f"data: {json.dumps({'type': 'execution_plan', 'steps': execution_plan_events}, ensure_ascii=False)}\n\n"
                        planner_event = _build_planner_event(output)
                        if planner_event:
                            yield f"data: {json.dumps(planner_event, ensure_ascii=False)}\n\n"
                    yield f"data: {json.dumps({'type': 'status', 'step_id': 'planner', 'action': 'end'}, ensure_ascii=False)}\n\n"

                elif kind == "on_chain_end" and name == "validator_agent":
                    output = event.get("data", {}).get("output", {})
                    if isinstance(output, dict):
                        audit_event_buffer.extend(output.get("audit_events") or [])
                        tool_call_buffer.extend(output.get("tool_calls") or [])
                        validator_event = _build_validator_event(output)
                        if validator_event:
                            yield f"data: {json.dumps(validator_event, ensure_ascii=False)}\n\n"
                    yield f"data: {json.dumps({'type': 'status', 'step_id': 'validator', 'action': 'end'}, ensure_ascii=False)}\n\n"

                elif kind == "on_chain_end" and name == "repair_agent":
                    output = event.get("data", {}).get("output", {})
                    if isinstance(output, dict):
                        audit_event_buffer.extend(output.get("audit_events") or [])
                        tool_call_buffer.extend(output.get("tool_calls") or [])
                        repair = (output.get("memory_context") or {}).get("repair") or {}
                        if repair.get("repaired") and repair.get("repaired_code"):
                            repair_code_override = repair.get("repaired_code", "")
                        repair_event = _build_repair_event(output)
                        if repair_event:
                            yield f"data: {json.dumps(repair_event, ensure_ascii=False)}\n\n"
                    yield f"data: {json.dumps({'type': 'status', 'step_id': 'repair', 'action': 'end'}, ensure_ascii=False)}\n\n"

                elif kind == "on_chain_end" and name == "consistency_agent":
                    output = event.get("data", {}).get("output", {})
                    if isinstance(output, dict):
                        audit_event_buffer.extend(output.get("audit_events") or [])
                        tool_call_buffer.extend(output.get("tool_calls") or [])
                        consistency = (output.get("memory_context") or {}).get("consistency") or {}
                        consistency_needs_user_input = bool(consistency.get("needs_user_input"))
                        consistency_event = _build_consistency_event(output)
                        if consistency_event:
                            consistency_event_payload = consistency_event
                            validation_events.append({"type": "knowledge_consistency", **consistency_event})
                            yield f"data: {json.dumps(consistency_event, ensure_ascii=False)}\n\n"
                    yield f"data: {json.dumps({'type': 'status', 'step_id': 'consistency', 'action': 'end'}, ensure_ascii=False)}\n\n"

                elif kind == "on_chain_end" and name == "design_agent":
                    output = event.get("data", {}).get("output", {})
                    if isinstance(output, dict):
                        audit_event_buffer.extend(output.get("audit_events") or [])
                        tool_call_buffer.extend(output.get("tool_calls") or [])
                        design = (output.get("memory_context") or {}).get("design") or {}
                        if design.get("changed") and design.get("designed_code"):
                            design_code_override = design.get("designed_code", "")
                        design_event = _build_design_agent_event(output)
                        if design_event:
                            yield f"data: {json.dumps(design_event, ensure_ascii=False)}\n\n"
                    yield f"data: {json.dumps({'type': 'status', 'step_id': 'designer', 'action': 'end'}, ensure_ascii=False)}\n\n"

                elif kind == "on_chain_end" and name == "export_agent":
                    output = event.get("data", {}).get("output", {})
                    if isinstance(output, dict):
                        audit_event_buffer.extend(output.get("audit_events") or [])
                        tool_call_buffer.extend(output.get("tool_calls") or [])
                        export_event = _build_export_plan_event(output)
                        if export_event:
                            yield f"data: {json.dumps(export_event, ensure_ascii=False)}\n\n"
                    yield f"data: {json.dumps({'type': 'status', 'step_id': 'export', 'action': 'end'}, ensure_ascii=False)}\n\n"

                elif kind == "on_chain_start":
                    if name == "router":
                        in_router = True
                        yield f"data: {json.dumps({'type': 'status', 'step_id': 'router', 'content': '分析修改意图', 'action': 'start'}, ensure_ascii=False)}\n\n"
                    elif name == "planner_agent":
                        yield f"data: {json.dumps({'type': 'status', 'step_id': 'planner', 'content': '拆解任务与制定生成计划', 'action': 'start'}, ensure_ascii=False)}\n\n"
                    elif name == "knowledge_agent":
                        yield f"data: {json.dumps({'type': 'status', 'step_id': 'knowledge', 'content': '检索企业知识上下文', 'action': 'start'}, ensure_ascii=False)}\n\n"
                    elif name == "design_agent":
                        yield f"data: {json.dumps({'type': 'status', 'step_id': 'designer', 'content': '优化布局、样式和可读性', 'action': 'start'}, ensure_ascii=False)}\n\n"
                    elif name == "validator_agent":
                        label = "校验办公产物结构与输出安全" if is_office_artifact(current_engine_name) else "校验图表结构与输出安全"
                        yield f"data: {json.dumps({'type': 'status', 'step_id': 'validator', 'content': label, 'action': 'start'}, ensure_ascii=False)}\n\n"
                    elif name == "repair_agent":
                        yield f"data: {json.dumps({'type': 'status', 'step_id': 'repair', 'content': '修复可自动纠正的输出问题', 'action': 'start'}, ensure_ascii=False)}\n\n"
                    elif name == "consistency_agent":
                        yield f"data: {json.dumps({'type': 'status', 'step_id': 'consistency', 'content': '检查与企业知识约束的一致性', 'action': 'start'}, ensure_ascii=False)}\n\n"
                    elif name == "export_agent":
                        yield f"data: {json.dumps({'type': 'status', 'step_id': 'export', 'content': '准备导出计划', 'action': 'start'}, ensure_ascii=False)}\n\n"
                    elif name.endswith("_agent"):
                        current_engine_name = current_engine_name if name == "office_artifact_agent" else name.replace("_agent", "")
                        if not current_task_name:
                            current_task_name = get_task_for_engine(current_engine_name)
                        yield f"data: {json.dumps({'type': 'agent', 'name': current_engine_name, 'task': current_task_name}, ensure_ascii=False)}\n\n"
                        
                        engine_zh = {
                            "excalidraw": "手绘白板",
                            "mermaid": "标准图表",
                            "flow": "React Flow 工作流",
                            "mindmap": "思维导图",
                            "charts": "ECharts 数据图表",
                            "drawio": "Draw.io 架构图",
                            "infographic": "可视化信息图",
                            "html_email": "HTML 邮件",
                            "web_report_html": "HTML 网页分析稿",
                            "office_artifact": "办公产物",
                        }.get(current_engine_name, "图表")
                        yield f"data: {json.dumps({'type': 'status', 'step_id': 'agent', 'content': f'调配 {engine_zh} 专家', 'action': 'start'}, ensure_ascii=False)}\n\n"

                elif kind == "on_chat_model_start":
                    if not in_router:
                        yield f"data: {json.dumps({'type': 'status', 'step_id': 'agent', 'action': 'end'}, ensure_ascii=False)}\n\n"
                        yield f"data: {json.dumps({'type': 'status', 'step_id': 'llm', 'content': '构思方案与设计', 'action': 'start'}, ensure_ascii=False)}\n\n"

            for pe in parser.flush():
                if pe.get("type") == "design":
                    design_buffer += pe.get("content", "")
                elif pe.get("type") == "text":
                    assistant_content += pe.get("content", "")
                if pe.get("type") == "code_complete":
                    yield f"data: {json.dumps({'type': 'status', 'step_id': 'generating', 'action': 'end'}, ensure_ascii=False)}\n\n"
                    pe["content"] = normalize_generated_code(
                        current_engine_name,
                        pe.get("content", ""),
                    )
                    latest_code = pe.get("content", "")
                    validation = validate_output(
                        current_engine_name,
                        pe.get("content", ""),
                    )
                    validation_event = {"type": "validation", **validation}
                    validation_events.append(validation_event)
                    yield f"data: {json.dumps(validation_event, ensure_ascii=False)}\n\n"
                yield f"data: {json.dumps(pe, ensure_ascii=False)}\n\n"

            final_code_override = repair_code_override or design_code_override
            if final_code_override and final_code_override != latest_code:
                latest_code = final_code_override
                validation = validate_output(current_engine_name, latest_code)
                validation_event = {"type": "validation", **validation}
                validation_events.append(validation_event)
                yield f"data: {json.dumps(validation_event, ensure_ascii=False)}\n\n"
                yield f"data: {json.dumps({'type': 'code_complete', 'content': latest_code}, ensure_ascii=False)}\n\n"
                yield f"data: {json.dumps({'type': 'code_end'}, ensure_ascii=False)}\n\n"

            if consistency_needs_user_input:
                assistant_content += "\n\n生成结果与企业知识约束存在冲突，已停止自动导出，等待人工确认。"

            saved_diagram = await persist_generated_diagram(
                permission_context=permission_context,
                conversation_id=conversation_id,
                user_message=user_message,
                assistant_content=assistant_content,
                diagram_code=latest_code,
                design_concept=design_buffer,
                task_type=current_task_name,
                engine_type=current_engine_name,
                validation_events=validation_events,
                run_id=run_id,
                diagram_id=current_diagram_id,
            )
            if saved_diagram:
                yield f"data: {json.dumps({'type': 'diagram_saved', **saved_diagram}, ensure_ascii=False)}\n\n"
                if consistency_needs_user_input:
                    try:
                        async with async_session() as session:
                            approval = await create_human_approval_request(
                                session,
                                permission_context=permission_context,
                                approval_type="knowledge_consistency",
                                reason="Generated diagram conflicts with explicit enterprise knowledge constraints.",
                                resource_json={
                                    "kind": "diagram",
                                    "diagram_id": saved_diagram.get("diagram_id"),
                                    "diagram_version_id": saved_diagram.get("diagram_version_id"),
                                    "version_number": saved_diagram.get("version_number"),
                                    "engine_type": current_engine_name,
                                    "task_type": current_task_name,
                                    "code_hash": hashlib.sha256(latest_code.encode("utf-8")).hexdigest(),
                                    "consistency": consistency_event_payload or {},
                                },
                                conversation_id=conversation_id,
                                agent_run_id=run_id,
                                required_scope="approval:write",
                            )
                            await session.commit()
                            yield f"data: {json.dumps({'type': 'human_approval_required', **serialize_approval_request(approval)}, ensure_ascii=False)}\n\n"
                    except Exception as exc:
                        logger.warning(f"Human approval request persistence skipped: {exc}")

            trace_spans = trace_recorder.finish(status=stream_status)
            audit_event_buffer.append(trace_recorder.to_audit_event(trace_spans))
            await persist_agent_run_finish(
                run_id=run_id,
                permission_context=permission_context,
                status=stream_status,
                task_type=current_task_name,
                engine_type=current_engine_name,
                execution_plan=execution_plan_events,
                validation_events=validation_events,
                audit_events=audit_event_buffer,
                tool_calls=tool_call_buffer,
                error_message=stream_error,
                conversation_id=conversation_id,
                token_usage={
                    "estimated_input_tokens": runtime_guard["estimated_input_tokens"],
                    "estimated_output_tokens": runtime_guard["estimated_output_tokens"],
                    "estimated_total_tokens": runtime_guard["estimated_total_tokens"],
                    "stream_event_count": loop_guard.event_count,
                },
                cost_estimate=runtime_guard["estimated_cost"],
                trace_spans=trace_spans,
            )
            yield f"data: {json.dumps({'type': 'done'})}\n\n"

        except RuntimeGuardError as e:
            stream_status = "failed"
            stream_error = str(e)
            audit_event_buffer.append(
                {
                    "type": "runtime.loop_guard.triggered",
                    "actor_user_id": permission_context.get("user_id"),
                    "tenant_id": permission_context.get("tenant_id"),
                    "project_id": permission_context.get("project_id"),
                    "message": stream_error,
                    "metadata": {
                        "stream_event_count": loop_guard.event_count,
                        "chain_start_counts": dict(loop_guard.chain_start_counts),
                    },
                }
            )
            trace_spans = trace_recorder.finish(status=stream_status)
            audit_event_buffer.append(trace_recorder.to_audit_event(trace_spans))
            await persist_agent_run_finish(
                run_id=run_id,
                permission_context=permission_context,
                status=stream_status,
                task_type=current_task_name,
                engine_type=current_engine_name,
                execution_plan=execution_plan_events,
                validation_events=validation_events,
                audit_events=audit_event_buffer,
                tool_calls=tool_call_buffer,
                error_message=stream_error,
                conversation_id=conversation_id,
                token_usage={
                    "estimated_input_tokens": runtime_guard["estimated_input_tokens"],
                    "estimated_output_tokens": runtime_guard["estimated_output_tokens"],
                    "estimated_total_tokens": runtime_guard["estimated_total_tokens"],
                    "stream_event_count": loop_guard.event_count,
                },
                cost_estimate=runtime_guard["estimated_cost"],
                trace_spans=trace_spans,
            )
            logger.error(f"Runtime guard error: {e}")
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

        except Exception as e:
            stream_status = "failed"
            stream_error = str(e)
            trace_spans = trace_recorder.finish(status=stream_status)
            audit_event_buffer.append(trace_recorder.to_audit_event(trace_spans))
            await persist_agent_run_finish(
                run_id=run_id,
                permission_context=permission_context,
                status=stream_status,
                task_type=current_task_name,
                engine_type=current_engine_name,
                execution_plan=execution_plan_events,
                validation_events=validation_events,
                audit_events=audit_event_buffer,
                tool_calls=tool_call_buffer,
                error_message=stream_error,
                conversation_id=conversation_id,
                token_usage={
                    "estimated_input_tokens": runtime_guard["estimated_input_tokens"],
                    "estimated_output_tokens": runtime_guard["estimated_output_tokens"],
                    "estimated_total_tokens": runtime_guard["estimated_total_tokens"],
                    "stream_event_count": loop_guard.event_count,
                },
                cost_estimate=runtime_guard["estimated_cost"],
                trace_spans=trace_spans,
            )
            logger.error(f"Stream error: {e}")
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/health")
async def health():
    return {"status": "ok", "service": "SmartDiagram API"}
