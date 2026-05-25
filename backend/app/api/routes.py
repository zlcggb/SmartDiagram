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
from app.core.llm import extract_text_content
from app.core.logger import logger

router = APIRouter()


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
        llm_ended = False        # Track if LLM step has ended
        in_router = False        # Track if currently executing the router chain

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
                                if pe.get("type") == "code_start":
                                    yield f"data: {json.dumps({'type': 'status', 'step_id': 'generating', 'content': '生成与绘制图表', 'action': 'start'}, ensure_ascii=False)}\n\n"
                                elif pe.get("type") == "code_complete":
                                    yield f"data: {json.dumps({'type': 'status', 'step_id': 'generating', 'action': 'end'}, ensure_ascii=False)}\n\n"
                                    if current_engine_name == "drawio":
                                        pe["content"] = sanitize_drawio_xml(pe["content"])
                                yield f"data: {json.dumps(pe, ensure_ascii=False)}\n\n"

                elif kind == "on_chain_end" and name == "router":
                    in_router = False
                    output = event.get("data", {}).get("output", {})
                    if isinstance(output, dict):
                        current_task_name = output.get("task_type", "") or current_task_name
                        current_engine_name = output.get("engine_type", "") or current_engine_name
                        if current_task_name or current_engine_name:
                            yield f"data: {json.dumps({'type': 'route', 'task': current_task_name, 'engine': current_engine_name}, ensure_ascii=False)}\n\n"
                    yield f"data: {json.dumps({'type': 'status', 'step_id': 'router', 'action': 'end'}, ensure_ascii=False)}\n\n"

                elif kind == "on_chain_start":
                    if name == "router":
                        in_router = True
                        yield f"data: {json.dumps({'type': 'status', 'step_id': 'router', 'content': '分析修改意图', 'action': 'start'}, ensure_ascii=False)}\n\n"
                    elif name.endswith("_agent"):
                        current_engine_name = name.replace("_agent", "")
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
                            "infographic": "可视化信息图"
                        }.get(current_engine_name, "图表")
                        yield f"data: {json.dumps({'type': 'status', 'step_id': 'agent', 'content': f'调配 {engine_zh} 专家', 'action': 'start'}, ensure_ascii=False)}\n\n"

                elif kind == "on_chat_model_start":
                    if not in_router:
                        yield f"data: {json.dumps({'type': 'status', 'step_id': 'agent', 'action': 'end'}, ensure_ascii=False)}\n\n"
                        yield f"data: {json.dumps({'type': 'status', 'step_id': 'llm', 'content': '构思方案与设计', 'action': 'start'}, ensure_ascii=False)}\n\n"

            for pe in parser.flush():
                if pe.get("type") == "code_complete":
                    yield f"data: {json.dumps({'type': 'status', 'step_id': 'generating', 'action': 'end'}, ensure_ascii=False)}\n\n"
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
