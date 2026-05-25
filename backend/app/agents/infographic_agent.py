"""
Infographic Agent — generates AntV Infographic DSL code.
Uses a two-phase pipeline: template selection → code generation.
Supports both new creation and incremental editing.
"""

from langchain_core.messages import SystemMessage, HumanMessage, AIMessage
from app.state.state import AgentState
from app.core.llm import create_llm_for_agent, extract_text_content
from app.data.template_syntax import (
    TEMPLATES,
    COMMON_SYNTAX_RULES,
    get_syntax_rules_for_template,
    get_template_list_for_prompt,
    get_common_syntax_rules,
)


# ─── Phase 1: Template Selection Prompt ───

TEMPLATE_SELECTION_PROMPT = """You are a template selector for the AntV Infographic system.
Your task is to choose the SINGLE BEST template for the user's request.

## Available Templates
{template_list}

## Selection Guide
- **chart-***: For numeric data visualization (bar, line, pie, wordcloud)
- **compare-***: For comparisons, pros/cons, SWOT analysis, quadrant charts
- **hierarchy-***: For tree structures, org charts, mind maps
- **list-***: For feature lists, step lists, grids, timelines
- **relation-***: For flowcharts, relationship diagrams with connections
- **sequence-***: For processes, timelines, roadmaps, funnels, pyramids

## Rules
1. Analyze the user's intent and content
2. Match to the most appropriate template category first, then specific template
3. Prefer visually rich templates (badge-card, compact-card) over plain-text variants
4. For timelines → sequence-timeline-* or list-row-*
5. For comparisons → compare-binary-* or compare-swot
6. For processes → sequence-snake-steps-* or sequence-roadmap-*
7. For data → chart-pie-* or chart-column-*

Respond with ONLY the template name. Example: sequence-timeline-simple
"""

# ─── Phase 2: Code Generation Prompt ───

CODE_GENERATION_PROMPT = """You are the Infographic Code Generator for SmartDiagram.
Generate AntV Infographic DSL code using the specified template.

## Selected Template: {template_name}

## DSL Syntax Rules
{common_rules}

## Template-Specific Syntax
{template_rules}

## Syntax Example
```
{syntax_example}
```

## OUTPUT FORMAT
Output your response using these XML-style tags:

<design_concept>
Your design reasoning: template choice rationale, data organization, color scheme (1-3 sentences)
</design_concept>

<code>
The AntV Infographic DSL code here (raw DSL, no code fences)
</code>

## RULES
1. The FIRST line of <code> MUST be `infographic {template_name}`
2. Follow the exact syntax structure shown in the example
3. Use meaningful, content-rich labels and descriptions
4. Keep text within length constraints (title ≤30 chars, desc ≤80 chars)
5. Use appropriate icons (lucide/*, mdi/*, or keyword icons)
6. Choose a theme that matches the content mood
7. Generate 4-8 items for optimal visual balance
8. Output ONLY the two XML tags, nothing else

## EDIT MODE
If the user's message contains <existing_code>, they want to MODIFY the existing infographic.
When editing:
- Parse the existing DSL code and understand its structure
- Make ONLY the changes the user requested
- Preserve the template type and overall structure
- Output the COMPLETE modified DSL code in <code> tags

Respond in the same language as the user's input.
"""


async def infographic_agent_node(state: AgentState) -> dict:
    """Two-phase infographic generation: template selection → code generation."""
    llm = create_llm_for_agent(state, "infographic")
    messages = list(state["messages"])

    # Check if this is an edit request (has existing code)
    last_msg = messages[-1]
    user_text = last_msg.content if isinstance(last_msg.content, str) else ""
    is_edit = "<existing_code>" in user_text

    if is_edit:
        # For edit mode, try to extract the template name from existing code
        import re
        template_match = re.search(r'infographic\s+([\w-]+)', user_text)
        if template_match:
            selected_template = template_match.group(1)
        else:
            selected_template = "list-grid-badge-card"  # fallback
    else:
        # Phase 1: Template Selection
        template_list = get_template_list_for_prompt()
        selection_prompt = TEMPLATE_SELECTION_PROMPT.format(template_list=template_list)

        selection_response = await llm.ainvoke([
            SystemMessage(content=selection_prompt),
            HumanMessage(content=user_text),
        ])

        selected_template = extract_text_content(selection_response.content).strip().lower()
        # Validate template exists
        all_templates = []
        for templates in TEMPLATES.values():
            all_templates.extend(templates)
        if selected_template not in all_templates:
            # Try to find best match
            for t in all_templates:
                if t in selected_template:
                    selected_template = t
                    break
            else:
                selected_template = "list-grid-badge-card"  # safe fallback

    # Phase 2: Code Generation with template-specific rules
    rules = get_syntax_rules_for_template(selected_template)
    common_rules = get_common_syntax_rules()
    syntax_example = rules.get("syntax_example", "")
    template_rules_text = ""
    if rules.get("notes"):
        template_rules_text = "\n".join(f"- {n}" for n in rules["notes"])
    if rules.get("item_fields"):
        template_rules_text += f"\nItem fields: {', '.join(rules['item_fields'])}"

    code_prompt = CODE_GENERATION_PROMPT.format(
        template_name=selected_template,
        common_rules=common_rules,
        template_rules=template_rules_text,
        syntax_example=syntax_example,
    )

    response = await llm.ainvoke(
        [SystemMessage(content=code_prompt)] + messages
    )

    return {"messages": [AIMessage(content=extract_text_content(response.content))]}
