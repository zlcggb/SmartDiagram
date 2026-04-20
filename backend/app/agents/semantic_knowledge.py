"""
Shared semantic knowledge for all diagram agents.
Extracted from fireworks-tech-graph best practices:
  - Shape Vocabulary: concept → shape mapping
  - Arrow Semantics: color + dash = meaning
  - Domain Patterns: common architecture templates
"""

# ─── Semantic Shape Vocabulary ───
# Maps conceptual entities to visual shapes across different engines.

SHAPE_VOCABULARY_EXCALIDRAW = """
## SEMANTIC SHAPE VOCABULARY
Map concepts to consistent shapes. When you see these entities, ALWAYS use the specified visual:

| Concept | Shape | Color (Fill/Stroke) | Notes |
|---------|-------|---------------------|-------|
| User / Human | Rectangle + "👤" prefix | `#fed7aa` / `#c2410c` | Input source |
| LLM / Model | Rectangle, **bold stroke** | `#ddd6fe` / `#6d28d9` | Double strokeWidth=3 |
| Agent / Orchestrator | Diamond or rectangle with **double border** (group_bg + inner rect) | `#dbeafe` / `#1e40af` | Active controller |
| Memory (short-term) | Rectangle, **dashed strokeStyle** | `#fef3c7` / `#b45309` | Ephemeral = dashed |
| Memory (long-term) | Rectangle, **solid**, wider shape | `#f3e8ff` / `#7c3aed` | Persistent = solid, DB-like |
| Vector Store | Rectangle with "🔢" prefix label | `#f3e8ff` / `#7c3aed` | Storage variant |
| Tool / Function | Rectangle with "⚙️" prefix label | `#ecfeff` / `#0e7490` | Callable tool |
| API / Gateway | Rectangle, **larger** hero size | `#d1fae5` / `#047857` | Entry point |
| Queue / Stream | Rectangle, narrow & wide (200×50) | `#f3f4f6` / `#374151` | Pipe shape |
| External Service | Rectangle, **dashed stroke** | `#ecfeff` / `#0e7490` | Dashed = external |
"""

SHAPE_VOCABULARY_DRAWIO = """
## SEMANTIC SHAPE VOCABULARY
When encountering these domain concepts, ALWAYS use the specified shape and color pairing:

| Concept | mxGraph Shape | Fill/Stroke | Notes |
|---------|--------------|-------------|-------|
| User / Human | `shape=mxgraph.basic.person` | `#dae8fc` / `#6c8ebf` | Actor |
| LLM / Model | `rounded=1;strokeWidth=3;` (bold rect) | `#e1d5e7` / `#9673a6` | Double-weight border = "AI brain" |
| Agent / Orchestrator | `shape=hexagon;perimeter=hexagonPerimeter2` | `#d5e8d4` / `#82b366` | Hexagon = active controller |
| Memory (short-term) | `rounded=1;dashed=1;` | `#fff3cd` / `#e6a817` | Dashed = ephemeral |
| Memory (long-term) | `shape=cylinder3` | `#ffe6cc` / `#d6a340` | Cylinder = persistent store |
| Vector Store | `shape=cylinder3` + label hint "🔢" | `#e1d5e7` / `#9673a6` | Ringed cylinder variant |
| Tool / Function | `rounded=1` + label "⚙ ToolName" | `#e6f3ff` / `#4d9de0` | Gear prefix |
| API / Gateway | `shape=hexagon;perimeter=hexagonPerimeter2` (single border) | `#d5e8d4` / `#82b366` | Smaller hexagon |
| Queue / Stream | `rounded=1` narrow+wide (220×40) | `#f5f5f5` / `#999999` | Pipe-like |
| Decision | `rhombus` | `#fff3cd` / `#e6a817` | Diamond |
| External Service | `rounded=1;dashed=1;` | `#e6f3ff` / `#4d9de0` | Dashed = external |
"""

SHAPE_VOCABULARY_FLOW = """
## SEMANTIC SHAPE VOCABULARY
Map domain concepts to node styles for richer, more meaningful diagrams:

| Concept | Node Style | Background/Border | Notes |
|---------|------------|-------------------|-------|
| User / Human | borderRadius: 50 (pill) | `#fed7aa` / `#c2410c` | Input source |
| LLM / Model | border: 3px solid (bold) | `#ddd6fe` / `#6d28d9` | Thick border = AI |
| Agent / Orchestrator | borderRadius: 0, border: 2px dashed | `#dbeafe` / `#1e40af` | Active controller |
| Memory | borderRadius: 8, border: dashed | `#fef3c7` / `#b45309` | Dashed = ephemeral |
| Tool / Function | borderRadius: 4 | `#ecfeff` / `#0e7490` | Utility |
| Database / Store | borderRadius: 16 (rounded) | `#f3e8ff` / `#7c3aed` | Persistent |
| Decision | diamond shape via CSS (rotate 45deg) or label "◆ ..." | `#fff7ed` / `#c2410c` | Fork |
| Start | pill (borderRadius: 50) | `#d1fae5` / `#047857` | Entry |
| End | pill (borderRadius: 50) | `#fee2e2` / `#dc2626` | Terminal |
"""

SHAPE_VOCABULARY_MERMAID = """
## SEMANTIC SHAPE VOCABULARY (via classDef)
Apply these classDefs for domain-specific node styling in flowcharts:

```
classDef user fill:#fed7aa,stroke:#c2410c,stroke-width:2px;
classDef llm fill:#ddd6fe,stroke:#6d28d9,stroke-width:3px;
classDef agent fill:#dbeafe,stroke:#1e40af,stroke-width:2px;
classDef memory fill:#fef3c7,stroke:#b45309,stroke-width:2px,stroke-dasharray:5 3;
classDef store fill:#f3e8ff,stroke:#7c3aed,stroke-width:2px;
classDef tool fill:#ecfeff,stroke:#0e7490,stroke-width:2px;
classDef gateway fill:#d1fae5,stroke:#047857,stroke-width:2px;
classDef external fill:#e6f3ff,stroke:#4d9de0,stroke-width:2px,stroke-dasharray:4 2;
```

Usage rules:
- Apply `:::user` for user/human nodes
- Apply `:::llm` for LLM/model nodes
- Apply `:::agent` for agent/orchestrator nodes
- Apply `:::memory` for cache/memory nodes (dashed border = ephemeral)
- Apply `:::store` for database/vector store nodes
- Apply `:::tool` for tool/function nodes
- Apply `:::gateway` for API/gateway nodes
- Apply `:::external` for external services (dashed = external boundary)
"""

# ─── Semantic Arrow System ───

ARROW_SEMANTICS_EXCALIDRAW = """
## SEMANTIC ARROW SYSTEM
Arrow color and style encode data flow meaning. ALWAYS use consistently:

| Flow Type | strokeColor | strokeStyle | Meaning |
|-----------|------------|-------------|---------|
| Primary data flow | `#1e40af` (blue) | `solid` | Main request/response path |
| Control / trigger | `#c2410c` (orange) | `solid` | One system triggering another |
| Memory read | `#047857` (green) | `solid` | Retrieval from store |
| Memory write | `#047857` (green) | `dashed` | Write/store operation |
| Async / event | `#374151` (gray) | `dashed` | Non-blocking, event-driven |
| Transform / embed | `#6d28d9` (purple) | `solid` | Data transformation |
| Feedback / loop | `#6d28d9` (purple) | `solid`, curved | Iterative reasoning loop |

**Rule**: When 2+ arrow types appear, add a legend group (free-floating text at bottom-left listing arrow meanings).
"""

ARROW_SEMANTICS_DRAWIO = """
## SEMANTIC ARROW SYSTEM
Arrow color and dash pattern encode meaning. Apply consistently:

| Flow Type | strokeColor | Dash Pattern | Meaning |
|-----------|------------|-------------|---------|
| Primary data flow | `#333333` | solid, strokeWidth=3 | Main request/response |
| Control / trigger | `#ea580c` | solid, strokeWidth=2 | System triggering |
| Memory read | `#059669` | solid, strokeWidth=2 | Retrieval from store |
| Memory write | `#059669` | `dashed=1;dashPattern=5 3;` | Write/store operation |
| Async / event | `#999999` | `dashed=1;dashPattern=8 4;` | Non-blocking events |
| Transform | `#7c3aed` | solid, strokeWidth=2 | Data transformation |
| Bidirectional | any color | `startArrow=classic;startFill=1;` | Two-way communication |

**Rule**: Add edge labels to indicate data type (e.g., "embeddings", "query", "JWT token").
**Rule**: When 2+ semantic arrow types are used, add a legend (text cell at bottom-left, no border).
"""

ARROW_SEMANTICS_FLOW = """
## SEMANTIC ARROW SYSTEM
Use edge styles and labels to encode meaning:

| Flow Type | Edge Style | Label Convention |
|-----------|-----------|-----------------|
| Primary data flow | `animated: false`, stroke: `#1e40af` | "request" / "response" |
| Control / trigger | `animated: false`, stroke: `#c2410c` | "trigger" / "invoke" |
| Memory read | `animated: false`, stroke: `#047857` | "retrieve" / "query" |
| Memory write | `animated: true`, stroke: `#047857` | "store" / "write" |
| Async / event | `animated: true`, stroke: `#6b7280` | "event" / "notify" |
| Error path | `animated: false`, stroke: `#dc2626` | "error" / "fallback" |

**Rule**: Always label edges with the data type or action verb.
"""

ARROW_SEMANTICS_MERMAID = """
## SEMANTIC ARROW SYSTEM
Use arrow styles and link text to convey meaning:

| Flow Type | Arrow Syntax | Link Text Convention |
|-----------|-------------|---------------------|
| Primary data flow | `-->` (solid arrow) | request / response |
| Control / trigger | `-->` (solid) | trigger / invoke |
| Memory read | `-.->` (dotted arrow) | retrieve / query |
| Memory write | `-.->` (dotted) | store / persist |
| Async / event | `-.->` (dotted) | event / notify |
| Return / response | `-->` (solid, reverse) | return / result |

**Rule**: Always add link text to describe data/action on the arrow.
"""

# ─── Domain Pattern Library ───

DOMAIN_PATTERNS = """
## AI / ARCHITECTURE DOMAIN PATTERNS
When the user mentions these patterns, use the corresponding standard structure as a starting point:

### RAG Pipeline
```
User Query → Query Embedding → Vector Search → Top-K Retrieval → Context Augmentation → LLM Generation → Response
```
Key components: Embedder, Vector Store, Retriever, Prompt Constructor, LLM, Response Formatter

### Agentic RAG
```
User Query → Agent (Planner) → [Tool: Search / Calculator / Code Exec] → Retrieve → LLM → Evaluate → (loop if insufficient) → Response
```
Adds: Agent reasoning loop, tool selection, self-evaluation

### Multi-Agent System
```
User Request → Orchestrator Agent → [Research Agent / Coding Agent / Review Agent] → Shared Memory → Synthesis Engine → Final Response
```
Key: Orchestrator dispatches tasks, shared memory for coordination, synthesis aggregates results

### Tool Call Flow
```
User → LLM → Tool Selector → Tool Execution → Result Parser → LLM (loop until done) → Response
```
Key: Iterative loop between LLM and tools, result parsing feeds back

### Memory Architecture (Mem0-style)
```
Input → Memory Manager → Write Path: [Vector Store + Graph DB + Key-Value Store]
                        → Read Path: [Retrieve + Rank + Context Build] → Personalized Response
```
Memory tiers: Working Memory → Short-term → Long-term → External Store

### Microservices Architecture
```
Client → API Gateway → Load Balancer → [Service A / Service B / Service C] → Message Queue → [Worker D / Worker E]
                                                                            → Database Layer [Primary DB / Cache / Search Index]
Monitoring: Metrics Collector → Dashboard
```

### Event-Driven Architecture
```
Producer → Event Bus (Kafka/RabbitMQ) → [Consumer A / Consumer B / Consumer C] → State Store
                                      → Dead Letter Queue → Alert System
```

### CI/CD Pipeline
```
Code Push → Build → Unit Tests → Integration Tests → Security Scan → Staging Deploy → E2E Tests → Production Deploy → Health Check
```
"""

DOMAIN_PATTERNS_MINDMAP = """
## AI / ARCHITECTURE DOMAIN KNOWLEDGE TEMPLATES
When users ask about these topics, use as expansion reference:

### AI/LLM 相关主题标准展开
- **LLM 应用架构**: Prompt Engineering / RAG / Fine-tuning / Agent / Evaluation
- **Agent 系统**: Planning → Tool Use → Memory → Reflection → Action
- **RAG 系统**: Data Ingestion → Chunking → Embedding → Indexing → Retrieval → Generation
- **MLOps**: Data Pipeline → Training → Evaluation → Deployment → Monitoring → Retraining

### 系统架构主题标准展开
- **微服务**: API Gateway / Service Discovery / Load Balancer / Circuit Breaker / Message Queue / Observability
- **云原生**: Container / Orchestration / Service Mesh / Serverless / GitOps / Observability
- **数据架构**: OLTP / OLAP / Data Lake / Data Warehouse / ETL / Stream Processing
"""


def get_shape_vocabulary(engine: str) -> str:
    """Get engine-specific shape vocabulary."""
    return {
        "excalidraw": SHAPE_VOCABULARY_EXCALIDRAW,
        "drawio": SHAPE_VOCABULARY_DRAWIO,
        "flow": SHAPE_VOCABULARY_FLOW,
        "mermaid": SHAPE_VOCABULARY_MERMAID,
    }.get(engine, "")


def get_arrow_semantics(engine: str) -> str:
    """Get engine-specific arrow semantics."""
    return {
        "excalidraw": ARROW_SEMANTICS_EXCALIDRAW,
        "drawio": ARROW_SEMANTICS_DRAWIO,
        "flow": ARROW_SEMANTICS_FLOW,
        "mermaid": ARROW_SEMANTICS_MERMAID,
    }.get(engine, "")


def get_domain_patterns(engine: str = "general") -> str:
    """Get domain patterns. mindmap gets a specialized version."""
    if engine == "mindmap":
        return DOMAIN_PATTERNS_MINDMAP
    return DOMAIN_PATTERNS
