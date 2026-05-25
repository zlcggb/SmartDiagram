"""
LLM factory for SmartDiagram.
Supports OpenAI-compatible APIs (OpenAI, DeepSeek, Ollama, vLLM, etc.)
with intelligent model routing per agent type.
"""

import os
from langchain_openai import ChatOpenAI
from langchain_core.language_models.chat_models import BaseChatModel
from app.core.config import settings


def extract_text_content(content) -> str:
    """Extract text from LLM response content.

    ChatGoogleGenerativeAI returns content as list[dict] with 'text' keys,
    while ChatOpenAI returns plain str. This normalizes both to str.
    """
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            part.get("text", "") if isinstance(part, dict) else str(part)
            for part in content
        )
    return str(content)


# ── Smart Model Routing ──
# Maps agent roles to their optimal model.
# Reasoning models (gpt-5.x) for understanding + design,
# faster models (gpt-5.1) for code/JSON generation.
# Override any mapping via env: MODEL_ROUTE_<AGENT>=model-name
AGENT_MODEL_ROUTING: dict[str, str] = {
    # Understanding & Design — use strongest reasoning model
    "router":       os.getenv("MODEL_ROUTE_ROUTER")      or os.getenv("MODEL_ID") or "gpt-5.4",
    "general":      os.getenv("MODEL_ROUTE_GENERAL")     or os.getenv("MODEL_ID") or "gpt-5",

    # Diagram generation — use fastest model for structured JSON output
    "excalidraw":   os.getenv("MODEL_ROUTE_EXCALIDRAW")  or os.getenv("MODEL_ID") or "gpt-5.1",
    "mermaid":      os.getenv("MODEL_ROUTE_MERMAID")     or os.getenv("MODEL_ID") or "gpt-5.1",
    "flow":         os.getenv("MODEL_ROUTE_FLOW")        or os.getenv("MODEL_ID") or "gpt-5.1",
    "drawio":       os.getenv("MODEL_ROUTE_DRAWIO")      or os.getenv("MODEL_ID") or "gpt-5.1",
    "charts":       os.getenv("MODEL_ROUTE_CHARTS")      or os.getenv("MODEL_ID") or "gpt-5.1",
    "infographic":  os.getenv("MODEL_ROUTE_INFOGRAPHIC") or os.getenv("MODEL_ID") or "gpt-5.1",
    "mindmap":      os.getenv("MODEL_ROUTE_MINDMAP")     or os.getenv("MODEL_ID") or "gpt-5.1",
}


def create_llm(
    model: str | None = None,
    api_key: str | None = None,
    base_url: str | None = None,
    temperature: float | None = None,
    max_tokens: int | None = None,
) -> BaseChatModel:
    """
    Create a ChatOpenAI or ChatVertexAI instance with the given or default configuration.

    Priority:
    1. Explicit arguments (e.g., from user's custom model config in the UI)
    2. Environment variable defaults
    """
    final_key = (api_key or "").strip() or settings.OPENAI_API_KEY
    final_url = (base_url or "").strip() or settings.OPENAI_BASE_URL
    final_model = (model or "").strip() or settings.MODEL_ID
    final_temp = temperature if temperature is not None else settings.TEMPERATURE
    final_tokens = max_tokens if max_tokens is not None else settings.MAX_TOKENS

    # Check if Vertex AI / Google AI is enabled and routing is requested for Gemini
    if os.getenv("USE_VERTEX_AI") == "true" and final_model and ("gemini" in final_model.lower()):
        from langchain_google_genai import ChatGoogleGenerativeAI
        
        # Extract model name without credentials prefixes
        model_name = final_model
        if "/" in model_name:
            model_name = model_name.split("/")[-1]
            
        # Use the new Gen AI SDK (supports gemini-3.5-flash and all latest models)
        return ChatGoogleGenerativeAI(
            model=model_name,
            project=os.getenv("VERTEX_PROJECT_ID", "gen-lang-client-0447529049"),
            location=os.getenv("VERTEX_LOCATION", "us-central1"),
            temperature=final_temp,
            max_output_tokens=final_tokens,
        )

    # Normalize base URL
    final_url = final_url.rstrip("/")
    for suffix in ["/chat/completions", "/completions"]:
        if final_url.lower().endswith(suffix):
            final_url = final_url[: -len(suffix)].rstrip("/")
            break

    return ChatOpenAI(
        api_key=final_key,
        base_url=final_url,
        model=final_model,
        temperature=final_temp,
        streaming=True,
        request_timeout=45,
        max_retries=1,
        max_tokens=final_tokens,
    )


def create_llm_from_state(state: dict, temperature: float = 0.3) -> BaseChatModel:
    """Create an LLM from AgentState's model_config, falling back to defaults."""
    config = state.get("model_config") or {}
    return create_llm(
        model=config.get("model_id"),
        api_key=config.get("api_key"),
        base_url=config.get("base_url"),
        temperature=temperature,
    )


def create_llm_for_agent(
    state: dict,
    agent_name: str,
    temperature: float = 0.3,
) -> BaseChatModel:
    """Create an LLM routed by agent type.

    Priority:
    1. User-specified model in UI (model_config.model_id) — always wins
    2. AGENT_MODEL_ROUTING[agent_name] — smart default per agent
    3. settings.MODEL_ID — global fallback
    """
    config = state.get("model_config") or {}
    user_model = (config.get("model_id") or "").strip()

    if user_model:
        # User explicitly chose a model — respect it
        chosen_model = user_model
    else:
        # Auto-route by agent type
        chosen_model = AGENT_MODEL_ROUTING.get(agent_name, settings.MODEL_ID)

    return create_llm(
        model=chosen_model,
        api_key=config.get("api_key"),
        base_url=config.get("base_url"),
        temperature=temperature,
    )
