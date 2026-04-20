"""
API routes for SmartDiagram.
Includes SSE streaming endpoint for chat with agents.
Supports multi-turn conversation and incremental editing.
"""

import json
import re
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from langchain_core.messages import HumanMessage, AIMessage
from app.agents.orchestrator import graph
from app.agents.catalog import get_task_for_engine
from app.agents.drawio_agent import sanitize_drawio_xml
from app.core.logger import logger

router = APIRouter()


class StreamingTagParser:
    """
    Parse XML-style <design_concept> and <code> tags from streaming LLM output.
    Emits SSE events as content is received.

    For <code> blocks, performs incremental JSON object extraction
    for real-time rendering of diagram elements.
    """

    def __init__(self):
        self.buffer = ""
        self.in_design = False
        self.in_code = False
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
                code_match = self.buffer.find("<code>")

                if design_match != -1:
                    self.buffer = self.buffer[design_match + len("<design_concept>"):]
                    self.in_design = True
                    events.append({"type": "design_start"})
                    continue
                elif code_match != -1:
                    self.buffer = self.buffer[code_match + len("<code>"):]
                    self.in_code = True
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
                    break

            elif self.in_design:
                end_idx = self.buffer.find("</design_concept>")
                code_idx = self.buffer.find("<code>")

                # If <code> appears before </design_concept> (or design never closes),
                # auto-close design and switch to code parsing
                if code_idx != -1 and (end_idx == -1 or code_idx < end_idx):
                    content = self.buffer[:code_idx]
                    self.buffer = self.buffer[code_idx:]  # Leave <code> in buffer for next iteration
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
                end_idx = self.buffer.find("</code>")
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
                    self.buffer = self.buffer[end_idx + len("</code>"):]
                    self.in_code = False
                    continue
                else:
                    # Push buffer content to code buffer, keep a safety margin for </code>
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
            # Check if there's a <code> block hidden in the remaining design content
            code_idx = remaining.find("<code>")
            if code_idx != -1:
                design_part = remaining[:code_idx].strip()
                if design_part:
                    events.append({"type": "design", "content": design_part})
                events.append({"type": "design_end"})
                # Extract code content
                code_content = remaining[code_idx + len("<code>"):]
                code_end_idx = code_content.find("</code>")
                if code_end_idx != -1:
                    code_content = code_content[:code_end_idx]
                events.append({"type": "code_start"})
                events.append({"type": "code_complete", "content": code_content.strip()})
                events.append({"type": "code_end"})
            elif remaining:
                events.append({"type": "design", "content": remaining})
                events.append({"type": "design_end"})
        elif self.in_code:
            if remaining:
                self._code_buffer += remaining
                self._raw_code += remaining
            # Final extraction attempt
            element_events = self._extract_objects()
            events.extend(element_events)
            if self._raw_code.strip():
                events.append({"type": "code_complete", "content": self._raw_code.strip()})
            events.append({"type": "code_end"})

        self.buffer = ""
        return events


def _build_messages(body: dict) -> list:
    """Build LangChain message sequence from request body.

    Supports:
      - body["message"] — current user message (required)
      - body["images"] — list of base64 data-URL strings for vision (optional)
      - body["history"] — previous conversation turns (optional)

    Returns a list like [HumanMessage, AIMessage, ..., HumanMessage].
    """
    messages = []

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

    # If there's existing canvas code and the user wants to edit,
    # inject it so the Agent knows the current state.
    current_code = body.get("current_code", "")
    if current_code:
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

    async def event_generator():
        parser = StreamingTagParser()
        current_engine_name = ""  # Track which engine is active
        current_task_name = ""    # Track which task is active

        # Build multi-turn message sequence
        messages = _build_messages(body)

        current_engine = body.get("current_engine") or body.get("current_agent", "")
        current_task = body.get("current_task") or get_task_for_engine(current_engine)

        input_state = {
            "messages": messages,
            "intent": "",
            "task_type": "",
            "engine_type": "",
            "model_config": body.get("model_config"),
            "current_code": body.get("current_code", ""),
            "current_task": current_task,
            "current_engine": current_engine,
        }

        try:
            async for event in graph.astream_events(input_state, version="v2"):
                kind = event.get("event")

                if kind == "on_chat_model_stream":
                    chunk = event.get("data", {}).get("chunk")
                    if chunk and hasattr(chunk, "content") and chunk.content:
                        parsed_events = parser.feed(chunk.content)
                        for pe in parsed_events:
                            # Sanitize drawio XML before emitting code_complete
                            if pe.get("type") == "code_complete" and current_engine_name == "drawio":
                                pe["content"] = sanitize_drawio_xml(pe["content"])
                            yield f"data: {json.dumps(pe, ensure_ascii=False)}\n\n"

                elif kind == "on_chain_end" and event.get("name") == "router":
                    output = event.get("data", {}).get("output", {})
                    if isinstance(output, dict):
                        current_task_name = output.get("task_type", "") or current_task_name
                        current_engine_name = output.get("engine_type", "") or current_engine_name
                        if current_task_name or current_engine_name:
                            yield f"data: {json.dumps({'type': 'route', 'task': current_task_name, 'engine': current_engine_name}, ensure_ascii=False)}\n\n"

                elif kind == "on_chain_start":
                    name = event.get("name", "")
                    if name.endswith("_agent"):
                        current_engine_name = name.replace("_agent", "")
                        if not current_task_name:
                            current_task_name = get_task_for_engine(current_engine_name)
                        yield f"data: {json.dumps({'type': 'agent', 'name': current_engine_name, 'task': current_task_name}, ensure_ascii=False)}\n\n"

            for pe in parser.flush():
                yield f"data: {json.dumps(pe, ensure_ascii=False)}\n\n"

            yield f"data: {json.dumps({'type': 'done'})}\n\n"

        except Exception as e:
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
