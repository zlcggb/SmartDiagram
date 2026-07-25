"""
AntV Infographic Template Syntax Rules

This file contains the syntax rules for all available infographic templates.
Each template has its own specific data structure and field requirements.
"""

# Template categories and their data field mappings
TEMPLATE_DATA_FIELDS = {
    "list": "lists",      # list-* templates use "lists" field
    "sequence": "sequences",  # sequence-* templates use "sequences" field
    "compare": "compares",    # compare-* templates use "compares" field
    "hierarchy": "root",      # hierarchy-* templates use "root" field (except hierarchy-structure)
    "relation": "nodes",      # relation-* templates use "nodes" + "relations" fields
    "chart": "values",        # chart-* templates use "values" field
}

# All available templates grouped by category
TEMPLATES = {
    # Chart templates - for data visualization
    "chart": [
        "chart-bar-plain-text",
        "chart-column-simple",
        "chart-line-plain-text",
        "chart-pie-compact-card",
        "chart-pie-donut-pill-badge",
        "chart-pie-donut-plain-text",
        "chart-pie-plain-text",
        "chart-wordcloud",
    ],

    # Compare templates - for comparisons and SWOT analysis
    "compare": [
        "compare-binary-horizontal-badge-card-arrow",
        "compare-binary-horizontal-simple-fold",
        "compare-binary-horizontal-underline-text-vs",
        "compare-hierarchy-left-right-circle-node-pill-badge",
        "compare-quadrant-quarter-circular",
        "compare-quadrant-quarter-simple-card",
        "compare-swot",
    ],

    # Hierarchy templates - for tree structures and mind maps
    "hierarchy": [
        "hierarchy-mindmap-branch-gradient-capsule-item",
        "hierarchy-mindmap-level-gradient-compact-card",
        "hierarchy-structure",
        "hierarchy-tree-curved-line-rounded-rect-node",
        "hierarchy-tree-tech-style-badge-card",
        "hierarchy-tree-tech-style-capsule-item",
    ],

    # List templates - for listing items
    "list": [
        "list-column-done-list",
        "list-column-simple-vertical-arrow",
        "list-column-vertical-icon-arrow",
        "list-grid-badge-card",
        "list-grid-candy-card-lite",
        "list-grid-ribbon-card",
        "list-row-horizontal-icon-arrow",
        "list-sector-plain-text",
        "list-zigzag-down-compact-card",
        "list-zigzag-down-simple",
        "list-zigzag-up-compact-card",
        "list-zigzag-up-simple",
    ],

    # Relation templates - for relationship diagrams
    "relation": [
        "relation-dagre-flow-tb-animated-badge-card",
        "relation-dagre-flow-tb-animated-simple-circle-node",
        "relation-dagre-flow-tb-badge-card",
        "relation-dagre-flow-tb-simple-circle-node",
    ],

    # Sequence templates - for processes, timelines, steps
    "sequence": [
        "sequence-ascending-stairs-3d-underline-text",
        "sequence-ascending-steps",
        "sequence-circular-simple",
        "sequence-color-snake-steps-horizontal-icon-line",
        "sequence-cylinders-3d-simple",
        "sequence-filter-mesh-simple",
        "sequence-funnel-simple",
        "sequence-horizontal-zigzag-underline-text",
        "sequence-mountain-underline-text",
        "sequence-pyramid-simple",
        "sequence-roadmap-vertical-plain-text",
        "sequence-roadmap-vertical-simple",
        "sequence-snake-steps-compact-card",
        "sequence-snake-steps-simple",
        "sequence-snake-steps-underline-text",
        "sequence-stairs-front-compact-card",
        "sequence-stairs-front-pill-badge",
        "sequence-timeline-rounded-rect-node",
        "sequence-timeline-simple",
        "sequence-zigzag-pucks-3d-simple",
        "sequence-zigzag-steps-underline-text",
    ],
}

# Get all template names as a flat list
ALL_TEMPLATES = []
for category_templates in TEMPLATES.values():
    ALL_TEMPLATES.extend(category_templates)

# Common syntax rules that apply to all templates
COMMON_SYNTAX_RULES = """
### DSL SYNTAX BASICS
- First line MUST be `infographic <template-name>`
- Use two-space indentation for blocks (`data`, `theme`)
- Key-value pairs: `key value` (key, space, value)
- Arrays: use `-` prefix for each item

### ICON FORMAT
- Use icon keywords like: `web`, `cloud`, `brain`, `star`, `flash`, `shield`
- Or use collection format: `lucide/rocket`, `mdi/account`
- Common icons: web, cloud, cellphone, brain, star, flash, shield, document, folder, code

### THEME OPTIONS
Basic themes:
```
theme light
theme dark
```

Custom palette:
```
theme light
  palette antv
```
or
```
theme
  palette
    - #3b82f6
    - #8b5cf6
    - #f97316
```

Hand-drawn style:
```
theme
  stylize rough
  base
    text
      font-family 851tegakizatsu
```

Available stylize options: rough (hand-drawn), pattern (pattern fill), linear-gradient, radial-gradient

### TEXT LENGTH CONSTRAINTS
- Title: Maximum 30 characters
- Description: Maximum 80 characters
- Item label: Maximum 15 characters
- Item desc: Maximum 50 characters
- Item value: Maximum 20 characters
"""

# Template syntax rules - detailed documentation for each template category
TEMPLATE_SYNTAX_RULES = {
    "chart": {
        "description": "Chart templates for data visualization with numeric values",
        "data_field": "values",
        "syntax_example": """infographic chart-pie-compact-card
data
  title Annual Revenue
  desc Revenue comparison by year
  values
    - label 2021
      value 120
      desc Initial phase
      icon lucide/sprout
    - label 2022
      value 210
      desc Growth
      icon lucide/trending-up
    - label 2023
      value 340
      desc Scale
      icon lucide/rocket
theme light
  palette antv""",
        "item_fields": ["label", "value", "desc", "icon"],
        "notes": [
            "value field is REQUIRED and must be numeric",
            "chart-wordcloud uses word frequency for sizing, value represents weight",
            "chart-pie-* work best with 3-8 items",
            "chart-bar-* and chart-column-* good for comparing values",
            "chart-line-* good for showing trends over time",
        ],
    },

    "compare": {
        "description": "Compare templates for binary comparisons, SWOT analysis, and quadrant charts",
        "data_field": "compares",
        "syntax_example": """infographic compare-swot
data
  title SWOT Analysis
  desc Strategic analysis
  compares
    - label Strengths
      children
        - label Strong brand
        - label Loyal users
    - label Weaknesses
      children
        - label High cost
        - label Slow release
    - label Opportunities
      children
        - label New markets
        - label AI integration
    - label Threats
      children
        - label Competition
        - label Regulation""",
        "item_fields": ["label", "desc", "children"],
        "notes": [
            "compare-binary-* and compare-hierarchy-left-right-* require EXACTLY 2 root nodes",
            "compare-swot requires EXACTLY 4 root nodes (Strengths/Weaknesses/Opportunities/Threats)",
            "compare-quadrant-* requires EXACTLY 4 items for four quadrants",
            "Use 'children' array for nested items within each category",
            "All comparison items should be placed inside 'children' of root nodes",
        ],
        "special_syntax": {
            "compare-binary": """infographic compare-binary-horizontal-badge-card-arrow
data
  title Pros vs Cons
  compares
    - label Pros
      children
        - label Advantage 1
        - label Advantage 2
    - label Cons
      children
        - label Disadvantage 1
        - label Disadvantage 2""",
            "compare-quadrant": """infographic compare-quadrant-quarter-simple-card
data
  title Priority Matrix
  compares
    - label High Impact Low Effort
    - label High Impact High Effort
    - label Low Impact Low Effort
    - label Low Impact High Effort""",
        },
    },

    "hierarchy": {
        "description": "Hierarchy templates for tree structures, org charts, and mind maps",
        "data_field": "root",
        "syntax_example": """infographic hierarchy-tree-tech-style-badge-card
data
  title Company Structure
  desc Organization hierarchy
  root
    label CEO
    children
      - label CTO
        children
          - label Dev Team
          - label QA Team
      - label CFO
        children
          - label Finance
          - label Accounting""",
        "item_fields": ["label", "desc", "icon", "children"],
        "notes": [
            "hierarchy-structure uses 'items' instead of 'root' for independent levels",
            "hierarchy-mindmap-* templates are for mind map layouts with branching",
            "hierarchy-tree-* templates are for vertical/horizontal tree layouts",
            "Use single 'root' node, nest children with 'children' array",
            "Maximum nesting depth is typically 3-4 levels",
            "Do NOT repeat 'root' keyword - only one root node allowed",
        ],
        "special_cases": {
            "hierarchy-structure": {
                "data_field": "items",
                "syntax_example": """infographic hierarchy-structure
data
  title Project Phases
  items
    - label Phase 1
      children
        - label Task A
        - label Task B
    - label Phase 2
      children
        - label Task C
        - label Task D""",
                "notes": [
                    "hierarchy-structure uses 'items' for flat independent levels",
                    "Each item can have children for sub-items",
                    "Maximum 3 levels of nesting",
                ],
            },
        },
    },

    "list": {
        "description": "List templates for displaying items in rows, columns, or grids",
        "data_field": "lists",
        "syntax_example": """infographic list-row-horizontal-icon-arrow
data
  title Internet Evolution
  desc Key milestones
  lists
    - time 1991
      label Web 1.0
      desc First website published
      icon web
    - time 2004
      label Web 2.0
      desc Social media era
      icon account multiple
    - time 2023
      label AI Era
      desc ChatGPT revolution
      icon brain""",
        "item_fields": ["label", "value", "desc", "icon", "time"],
        "notes": [
            "list-grid-* arrange items in a grid (good for features, cards)",
            "list-row-* arrange items horizontally with arrows",
            "list-column-* arrange items vertically",
            "list-zigzag-* create alternating zigzag layouts",
            "list-sector-* create sector/radial layouts",
            "'time' field is optional, good for timelines/history",
            "list-column-done-list good for checklists/todo items",
        ],
    },

    "relation": {
        "description": "Relation templates for flowcharts and relationship diagrams",
        "data_field": "nodes",
        "additional_field": "relations",
        "syntax_example": """infographic relation-dagre-flow-tb-simple-circle-node
data
  title Workflow
  desc System flow
  nodes
    - id A
      label Start
    - id B
      label Process
    - id C
      label End
  relations
    A --> B
    B --> C
    A -approval-> C""",
        "item_fields": ["id", "label", "desc", "icon"],
        "relation_syntax": [
            "A --> B : simple connection (arrow from A to B)",
            "A -label-> B : labeled connection with edge label",
            "A -->|label| B : alternative labeled connection syntax",
        ],
        "notes": [
            "'nodes' defines vertices with 'id' and 'label'",
            "'relations' defines edges between nodes using arrow syntax",
            "Simple graphs can omit 'nodes' if using labels in relations directly",
            "animated variants (relation-dagre-flow-tb-animated-*) have flowing animations",
            "'id' field is required for each node to reference in relations",
        ],
    },

    "sequence": {
        "description": "Sequence templates for processes, timelines, and step-by-step flows",
        "data_field": "sequences",
        "syntax_example": """infographic sequence-timeline-simple
data
  title Product Roadmap
  desc Development milestones
  sequences
    - label Q1 2024
      desc Planning
      icon lucide/clipboard
    - label Q2 2024
      desc Development
      icon lucide/code
    - label Q3 2024
      desc Testing
      icon lucide/bug
    - label Q4 2024
      desc Launch
      icon lucide/rocket
  order asc
theme light
  palette antv""",
        "item_fields": ["label", "value", "desc", "icon", "time"],
        "notes": [
            "'order' field can be 'asc' or 'desc' to control direction",
            "sequence-timeline-* for chronological events and timelines",
            "sequence-stairs-* for step-by-step progressions (ascending)",
            "sequence-funnel-* and sequence-filter-mesh-* for funnel visualizations",
            "sequence-pyramid-* for hierarchical/importance progressions",
            "sequence-snake-* for winding path layouts (S-shape)",
            "sequence-roadmap-* for project roadmaps and plans",
            "sequence-circular-* for cyclic/repeating processes",
            "sequence-zigzag-* for alternating step patterns",
        ],
    },
}

# Template selection guidance based on use case
TEMPLATE_SELECTION_GUIDE = {
    "process_flow": {
        "templates": ["sequence-snake-steps-compact-card", "sequence-timeline-simple", "sequence-roadmap-vertical-simple"],
        "description": "For showing step-by-step processes or workflows",
    },
    "comparison": {
        "templates": ["compare-binary-horizontal-badge-card-arrow", "compare-swot", "compare-quadrant-quarter-simple-card"],
        "description": "For comparing two or more options, pros/cons",
    },
    "data_chart": {
        "templates": ["chart-pie-compact-card", "chart-column-simple", "chart-bar-plain-text"],
        "description": "For visualizing numeric data and statistics",
    },
    "feature_list": {
        "templates": ["list-grid-badge-card", "list-row-horizontal-icon-arrow", "list-column-done-list"],
        "description": "For listing features, benefits, or items",
    },
    "org_chart": {
        "templates": ["hierarchy-tree-tech-style-badge-card", "hierarchy-structure"],
        "description": "For organization charts and hierarchical structures",
    },
    "mind_map": {
        "templates": ["hierarchy-mindmap-branch-gradient-capsule-item", "hierarchy-mindmap-level-gradient-compact-card"],
        "description": "For mind maps and brainstorming layouts",
    },
    "workflow": {
        "templates": ["relation-dagre-flow-tb-badge-card", "relation-dagre-flow-tb-simple-circle-node"],
        "description": "For flowcharts and process diagrams with connections",
    },
    "timeline": {
        "templates": ["sequence-timeline-simple", "sequence-timeline-rounded-rect-node", "list-row-horizontal-icon-arrow"],
        "description": "For chronological events and history",
    },
    "funnel": {
        "templates": ["sequence-funnel-simple", "sequence-filter-mesh-simple", "sequence-pyramid-simple"],
        "description": "For funnel charts and conversion flows",
    },
    "steps": {
        "templates": ["sequence-stairs-front-compact-card", "sequence-ascending-steps", "sequence-snake-steps-simple"],
        "description": "For numbered steps and procedures",
    },
}


def get_template_category(template_name: str) -> str:
    """Get the category of a template by its name."""
    for category, templates in TEMPLATES.items():
        if template_name in templates:
            return category
    return "unknown"


def get_data_field_for_template(template_name: str) -> str:
    """Get the appropriate data field name for a template."""
    # Special case for hierarchy-structure
    if template_name == "hierarchy-structure":
        return "items"

    category = get_template_category(template_name)
    return TEMPLATE_DATA_FIELDS.get(category, "items")


def get_syntax_rules_for_template(template_name: str) -> dict:
    """Get the syntax rules for a specific template."""
    category = get_template_category(template_name)
    rules = TEMPLATE_SYNTAX_RULES.get(category, {})

    # Check for special cases
    if category == "hierarchy" and template_name == "hierarchy-structure":
        if "special_cases" in rules and template_name in rules["special_cases"]:
            special = rules["special_cases"][template_name]
            return {**rules, **special}

    return rules


def get_template_list_for_prompt() -> str:
    """Generate a formatted template list for use in prompts."""
    lines = []
    for category, templates in TEMPLATES.items():
        lines.append(f"\n**{category.title()} Templates ({category}-*)**")
        lines.append(", ".join(templates))
    return "\n".join(lines)


def get_syntax_example_for_template(template_name: str) -> str:
    """Get the syntax example for a specific template."""
    rules = get_syntax_rules_for_template(template_name)
    return rules.get("syntax_example", "")


def get_common_syntax_rules() -> str:
    """Get the common syntax rules that apply to all templates."""
    return COMMON_SYNTAX_RULES
