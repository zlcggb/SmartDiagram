"""
Draw.io Agent — generates mxGraph XML for architecture and infrastructure diagrams.
Supports both new creation and incremental editing.
Includes post-processing to fix edge routing issues that LLMs cannot avoid.
"""

import re
import xml.etree.ElementTree as ET
from langchain_core.messages import SystemMessage, AIMessage
from app.state.state import AgentState
from app.core.llm import create_llm_for_agent
from app.agents.semantic_knowledge import (
    get_shape_vocabulary,
    get_arrow_semantics,
    get_domain_patterns,
)


def sanitize_drawio_xml(xml_content: str) -> str:
    """Remove invalid <Array> elements that LLMs sometimes generate in mxGraph XML."""
    xml_content = re.sub(r'<Array[^/>]*?/>', '', xml_content, flags=re.DOTALL)
    xml_content = re.sub(r'<Array[^>]*>[\s\S]*?</Array>', '', xml_content, flags=re.DOTALL)
    xml_content = re.sub(r'\n\s*\n', '\n', xml_content)
    return xml_content.strip()


def fix_container_nesting(xml_content: str) -> str:
    """Post-process mxGraph XML to fix container-child nesting.

    LLMs often generate child nodes with parent="1" (root layer) instead of
    parent="<container_id>". This function:
    1. Identifies container cells (large cells with dashed/container styles)
    2. Identifies leaf cells that SHOULD be inside containers
    3. Reassigns parent to the correct container
    4. Converts absolute coordinates to relative (offset from container top-left)
    5. Ensures children fit within container bounds, expanding if needed
    """
    try:
        root = ET.fromstring(xml_content)
    except ET.ParseError:
        return xml_content

    cells = root.findall('.//mxCell')
    if not cells:
        return xml_content

    # Step 1: Identify containers and leaf nodes
    # Containers are typically large cells with dashed borders or verticalAlign=top
    containers = []  # (cell, id, x, y, w, h)
    leaf_nodes = []  # (cell, id, x, y, w, h)
    edge_cells = []

    for cell in cells:
        cid = cell.get('id', '')
        if cid in ('0', '1'):
            continue
        if cell.get('edge') == '1':
            edge_cells.append(cell)
            continue
        if cell.get('vertex') != '1':
            continue

        geo = cell.find('mxGeometry')
        if geo is None:
            continue

        style = cell.get('style', '')
        x = float(geo.get('x', '0'))
        y = float(geo.get('y', '0'))
        w = float(geo.get('width', '0'))
        h = float(geo.get('height', '0'))

        # Detect containers: dashed border, or large relative to typical nodes,
        # or explicit container/group style indicators
        is_container = (
            'dashed=1' in style or
            'container=1' in style or
            ('verticalAlign=top' in style and w >= 200 and h >= 200) or
            (w >= 200 and h >= 200 and cell.get('parent') == '1')
        )

        # Heuristic: if it's big (area > 40000) AND has verticalAlign=top, it's a container
        if w * h > 40000 and 'verticalAlign=top' in style:
            is_container = True

        if is_container:
            containers.append((cell, cid, x, y, w, h))
        elif cell.get('parent') == '1':
            leaf_nodes.append((cell, cid, x, y, w, h))

    if not containers or not leaf_nodes:
        return xml_content

    # Step 2: For each leaf node, find if it's already inside a container (by coords)
    # or assign it to the nearest/best container
    container_children: dict[str, list] = {c[1]: [] for c in containers}

    unassigned = []
    for leaf in leaf_nodes:
        cell, lid, lx, ly, lw, lh = leaf
        lcx, lcy = lx + lw / 2, ly + lh / 2  # center

        # Check if leaf center is inside any container bounds
        matched = None
        for cont in containers:
            _, cid, cx, cy, cw, ch = cont
            if cx <= lcx <= cx + cw and cy <= lcy <= cy + ch:
                matched = cid
                break

        if matched:
            container_children[matched].append(leaf)
        else:
            unassigned.append(leaf)

    # Step 3: Distribute unassigned nodes to containers in order
    # But first, identify "root" nodes that connect TO containers — they should stay at root
    if unassigned and containers:
        container_id_set = {c[1] for c in containers}
        root_node_ids = set()
        for cell in cells:
            if cell.get('edge') == '1':
                src = cell.get('source', '')
                tgt = cell.get('target', '')
                # If this edge connects FROM a non-container TO a container, src is root
                if tgt in container_id_set and src not in container_id_set:
                    root_node_ids.add(src)
                if src in container_id_set and tgt not in container_id_set:
                    root_node_ids.add(tgt)

        # Filter out root nodes from unassigned
        truly_unassigned = [n for n in unassigned if n[1] not in root_node_ids]

        # Sort containers left-to-right, top-to-bottom
        sorted_containers = sorted(containers, key=lambda c: (c[3], c[2]))
        # Sort unassigned nodes similarly
        truly_unassigned.sort(key=lambda n: (n[4], n[3]))

        # Distribute evenly across containers that have fewer children
        for leaf in truly_unassigned:
            # Find container with fewest children
            min_count = min(len(container_children[c[1]]) for c in sorted_containers)
            for cont in sorted_containers:
                if len(container_children[cont[1]]) == min_count:
                    container_children[cont[1]].append(leaf)
                    break

    # Step 4: Reassign parent and fix coordinates
    for cont in containers:
        cont_cell, cid, cx, cy, cw, ch = cont
        children = container_children.get(cid, [])
        if not children:
            continue

        # Layout children vertically inside container
        # Start below the container title (top padding ~40px)
        padding_top = 40
        padding_side = 20
        spacing = 15
        available_w = cw - 2 * padding_side

        current_y = padding_top
        max_child_bottom = 0

        for i, (child_cell, child_id, lx, ly, lw, lh) in enumerate(children):
            # Set parent to container
            child_cell.set('parent', cid)

            # Calculate relative position inside container
            child_geo = child_cell.find('mxGeometry')
            if child_geo is None:
                continue

            # Center horizontally, stack vertically
            new_x = (cw - min(lw, available_w)) / 2
            new_y = current_y
            new_w = min(lw, available_w)

            child_geo.set('x', str(round(new_x)))
            child_geo.set('y', str(round(new_y)))
            child_geo.set('width', str(round(new_w)))

            current_y += lh + spacing
            max_child_bottom = new_y + lh

        # Step 5: Expand container if children overflow
        needed_h = max_child_bottom + padding_side
        if needed_h > ch:
            cont_geo = cont_cell.find('mxGeometry')
            if cont_geo is not None:
                cont_geo.set('height', str(round(needed_h)))

    return ET.tostring(root, encoding='unicode', xml_declaration=False)


def fix_edge_routing(xml_content: str) -> str:
    """Minimal post-processing: fix edge parent for intra-container edges.

    When both source and target of an edge are children of the same container,
    the edge's parent should be that container (not "1"). This ensures draw.io
    renders the edge in the container's local coordinate space.

    We intentionally do NOT:
    - Calculate or override exit/entry directions (LLM + draw.io handle this)
    - Strip exit/entry attributes (preserves LLM's layout intent)
    - Delete cross-container edges (prompt handles this)
    - Compute obstacle avoidance (draw.io does this natively)
    """
    try:
        root = ET.fromstring(xml_content)
    except ET.ParseError:
        return xml_content

    cells = root.findall('.//mxCell')
    if not cells:
        return xml_content

    # Identify containers
    container_ids = set()
    cell_parent = {}

    for cell in cells:
        cid = cell.get('id', '')
        cell_parent[cid] = cell.get('parent', '1')
        style = cell.get('style', '')
        if cell.get('vertex') == '1':
            geo = cell.find('mxGeometry')
            if geo is not None:
                w = float(geo.get('width', '0'))
                h = float(geo.get('height', '0'))
                if ('dashed=1' in style or 'container=1' in style or
                    ('verticalAlign=top' in style and w >= 200 and h >= 200)):
                    container_ids.add(cid)

    # Fix edge parent: if src and tgt are in the same container, edge parent = container
    for cell in cells:
        if cell.get('edge') != '1':
            continue

        src_id = cell.get('source', '')
        tgt_id = cell.get('target', '')
        if not src_id or not tgt_id:
            continue

        src_container = cell_parent.get(src_id, '1')
        tgt_container = cell_parent.get(tgt_id, '1')

        if (src_container == tgt_container and
            src_container in container_ids and
            cell.get('parent') != src_container):
            cell.set('parent', src_container)

    return ET.tostring(root, encoding='unicode', xml_declaration=False)


SYSTEM_PROMPT = """You are a Principal Solutions Architect and Draw.io Master creating **publication-quality** diagrams.
Generate valid mxGraph XML that is visually clear, well-organized, and uses diverse shapes and colors.

### ARCHITECTURAL ENRICHMENT (MANDATORY)
- **Expand simple requests**: If a user asks for "微服务架构", include API Gateway, Service Discovery, Load Balancer, Message Queue, and dedicated Data Stores — not just 3 boxes.
- **Add context**: Include users/clients, external integrations, monitoring, security layers, and data flow arrows.
- **Minimum complexity**: Generate at least 8-15 components for any diagram. Include supporting elements.
- **LANGUAGE**: All labels MUST match the user's input language.

## OUTPUT FORMAT
1. <design_concept> — your layout strategy (which layout pattern, tier grouping, shape choices)
2. <code> — raw mxGraph XML (NO markdown, NO code fences)

## GENERATION PROTOCOL
1. Generate id="0" root cell and id="1" layer cell
2. Generate ALL vertex cells (shapes) with exact coordinates
3. Generate ALL edge cells AFTER all vertices exist

## XML RULES
1. Root: `<mxCell id="0"/>` then `<mxCell id="1" parent="0"/>`
2. IDs: unique strings starting from "2" (like "n1","n2","e1")
3. Vertices: `vertex="1" parent="1"` with `<mxGeometry x="" y="" width="" height="" as="geometry"/>`
4. Edges: `edge="1" parent="1"` with valid `source` and `target` IDs
5. Edge geometry: `<mxGeometry relative="1" as="geometry"/>` — NO waypoints, NO Array elements
6. Every cell MUST have a `style` attribute
7. NO `<Array>` elements — they CRASH draw.io
8. NO newlines or raw HTML in `value` attributes

## ═══════════════════════════════════════
## SHAPE LIBRARY — Use the RIGHT shape for each concept
## ═══════════════════════════════════════

### Rectangles (processes, services, modules)
- Standard: `rounded=1;whiteSpace=wrap;html=1;arcSize=8;`
- Bold header: `rounded=1;whiteSpace=wrap;html=1;fontStyle=1;fontSize=14;`

### Database / Storage
- Cylinder: `shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;size=15;`

### Decision / Condition
- Diamond: `rhombus;whiteSpace=wrap;html=1;`

### Cloud / External Service
- Cloud: `ellipse;shape=cloud;whiteSpace=wrap;html=1;fontSize=12;`

### Hexagon (middleware, processing)
- Hexagon: `shape=hexagon;perimeter=hexagonPerimeter2;whiteSpace=wrap;html=1;fixedSize=1;`

### Oval / Start-End
- Ellipse: `ellipse;whiteSpace=wrap;html=1;`

### Document / File
- Document: `shape=document;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;size=0.27;`

### Callout / Note
- Callout: `shape=callout;whiteSpace=wrap;html=1;perimeter=calloutPerimeter;size=0;position=0.5;`

### Person / User
- Actor: `shape=mxgraph.basic.person;whiteSpace=wrap;html=1;`

### Group / Container (dashed border for categorization)
- Container: `rounded=1;whiteSpace=wrap;html=1;fillColor=#f8f9fa;strokeColor=#cccccc;dashed=1;strokeWidth=1;verticalAlign=top;fontStyle=1;fontSize=13;spacingTop=8;`

### Title Label (no border)
- Title: `text;html=1;strokeColor=none;fillColor=none;align=center;verticalAlign=middle;fontSize=18;fontStyle=1;fontColor=#333333;`

## ═══════════════════════════════════════
## COLOR PALETTE — Color encodes MEANING
## ═══════════════════════════════════════

| Category        | fillColor  | strokeColor | fontColor |
|----------------|-----------|-------------|-----------|
| User/Client     | #dae8fc   | #6c8ebf     | #1a3a5c   |
| API/Gateway     | #d5e8d4   | #82b366     | #2d5016   |
| Backend Service | #e1d5e7   | #9673a6     | #4a2d5e   |
| Database/Store  | #ffe6cc   | #d6a340     | #6b4c00   |
| Security/Auth   | #f8cecc   | #b85450     | #7a1a1a   |
| Cache/Queue     | #f5f5f5   | #999999     | #333333   |
| External/Cloud  | #e6f3ff   | #4d9de0     | #1a5276   |
| Highlight/Key   | #fff3cd   | #e6a817     | #856404   |

## ═══════════════════════════════════════
## EDGE STYLES — Vary connection types
## ═══════════════════════════════════════

| Type          | Style suffix                                      |
|--------------|--------------------------------------------------|
| Normal flow   | `strokeWidth=2;strokeColor=#999999;`              |
| Primary flow  | `strokeWidth=3;strokeColor=#333333;`              |
| Data flow     | `strokeWidth=2;strokeColor=#4d9de0;dashed=0;`     |
| Async/Event   | `strokeWidth=2;strokeColor=#999999;dashed=1;dashPattern=8 4;` |
| Bidirectional | Add `startArrow=classic;startFill=1;`             |

Edge base: `edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;`

""" + get_shape_vocabulary("drawio") + """

""" + get_arrow_semantics("drawio") + """

""" + get_domain_patterns() + """

## ═══════════════════════════════════════
## LAYOUT STRATEGY
## ═══════════════════════════════════════

### GRID SYSTEM
- Page: 1200×900 minimum, expand if content demands
- Container width: 240–280px, ALL containers SAME height
- Child node: width=160–180, height=50–60
- Horizontal gap between containers: 40–60px
- Child left margin inside container: 40px
- Child top offset (first child): 40px below container title
- Child vertical spacing: 20–30px between children

### CHOOSE LAYOUT based on content:

**A. Knowledge Map / Mind Map style (DEFAULT):**
- ROOT topic (ellipse, large bold) CENTERED at top
- Containers arranged in a SINGLE ROW below root, ALL same height
- Connections: root → each container (stagger exitX from root bottom)
- Inside each container: children flow top-to-bottom with arrows
- NO edges between containers or between children of different containers

**B. Architecture Diagram:**
- HORIZONTAL TIERS top-to-bottom: Client → Gateway → Services → Data
- Containers group related services. ALL containers same height per row.

**C. Flowchart / Process:**
- Top-to-bottom or left-to-right
- Diamonds for decisions, rounded rects for processes, ellipses for start/end

### CONTAINER + CHILD RULES (CRITICAL)

Children MUST use `parent="<container_id>"` with coordinates RELATIVE to container:
```xml
<!-- Container -->
<mxCell id="g1" value="Group" style="rounded=1;...dashed=1;verticalAlign=top;..." vertex="1" parent="1">
  <mxGeometry x="40" y="160" width="260" height="300" as="geometry"/>
</mxCell>
<!-- Child INSIDE container: parent="g1", coords relative to g1 -->
<mxCell id="n2" value="Item" style="rounded=1;..." vertex="1" parent="g1">
  <mxGeometry x="40" y="40" width="180" height="50" as="geometry"/>
</mxCell>
<!-- Edge inside container: parent="g1" -->
<mxCell id="e5" style="edgeStyle=orthogonalEdgeStyle;..." edge="1" source="n2" target="n3" parent="g1">
  <mxGeometry relative="1" as="geometry"/>
</mxCell>
```

### EDGE RULES
- **Root → Container**: `parent="1"`, stagger exitX (2→0.35/0.65, 3→0.25/0.5/0.75, 4→0.15/0.38/0.62/0.85)
- **Child → Child in same container**: `parent="<container_id>"`, exitX=0.5;exitY=1;entryX=0.5;entryY=0
- **NEVER connect children across containers** — lines will cut through other boxes

## COMPLETE EXAMPLE
```xml
<mxfile host="app.diagrams.net">
  <diagram name="Page" id="d1">
    <mxGraphModel dx="1200" dy="900" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1200" pageHeight="900" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        <!-- ROOT -->
        <mxCell id="n1" value="AI学习路线" style="ellipse;whiteSpace=wrap;html=1;fillColor=#fff3cd;strokeColor=#e6a817;fontColor=#856404;fontSize=18;fontStyle=1;shadow=1;" vertex="1" parent="1">
          <mxGeometry x="430" y="30" width="220" height="80" as="geometry"/>
        </mxCell>
        <!-- CONTAINER 1: Blue -->
        <mxCell id="g1" value="编程基础" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#f0f4ff;strokeColor=#6c8ebf;fontColor=#1a3a5c;dashed=1;strokeWidth=1;verticalAlign=top;fontStyle=1;fontSize=13;spacingTop=8;" vertex="1" parent="1">
          <mxGeometry x="40" y="160" width="260" height="280" as="geometry"/>
        </mxCell>
        <mxCell id="n2" value="Python基础" style="shape=hexagon;perimeter=hexagonPerimeter2;whiteSpace=wrap;html=1;fixedSize=1;fillColor=#dae8fc;strokeColor=#6c8ebf;fontColor=#1a3a5c;fontSize=12;shadow=1;" vertex="1" parent="g1">
          <mxGeometry x="40" y="40" width="180" height="50" as="geometry"/>
        </mxCell>
        <mxCell id="n3" value="数据处理" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;fontColor=#1a3a5c;fontSize=12;shadow=1;arcSize=8;" vertex="1" parent="g1">
          <mxGeometry x="40" y="110" width="180" height="50" as="geometry"/>
        </mxCell>
        <mxCell id="n4" value="开发工具" style="shape=document;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;fontColor=#1a3a5c;fontSize=12;boundedLbl=1;backgroundOutline=1;size=0.27;" vertex="1" parent="g1">
          <mxGeometry x="40" y="180" width="180" height="60" as="geometry"/>
        </mxCell>
        <mxCell id="e4" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;strokeWidth=2;strokeColor=#6c8ebf;exitX=0.5;exitY=1;exitDx=0;exitDy=0;entryX=0.5;entryY=0;entryDx=0;entryDy=0;" edge="1" source="n2" target="n3" parent="g1">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="e5" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;strokeWidth=2;strokeColor=#6c8ebf;exitX=0.5;exitY=1;exitDx=0;exitDy=0;entryX=0.5;entryY=0;entryDx=0;entryDy=0;" edge="1" source="n3" target="n4" parent="g1">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <!-- CONTAINER 2: Purple (SAME height=280) -->
        <mxCell id="g2" value="核心算法" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#f5f0fa;strokeColor=#9673a6;fontColor=#4a2d5e;dashed=1;strokeWidth=1;verticalAlign=top;fontStyle=1;fontSize=13;spacingTop=8;" vertex="1" parent="1">
          <mxGeometry x="350" y="160" width="260" height="280" as="geometry"/>
        </mxCell>
        <mxCell id="n5" value="机器学习" style="shape=hexagon;perimeter=hexagonPerimeter2;whiteSpace=wrap;html=1;fixedSize=1;fillColor=#e1d5e7;strokeColor=#9673a6;fontColor=#4a2d5e;fontSize=12;shadow=1;" vertex="1" parent="g2">
          <mxGeometry x="40" y="40" width="180" height="50" as="geometry"/>
        </mxCell>
        <mxCell id="n6" value="深度学习" style="shape=hexagon;perimeter=hexagonPerimeter2;whiteSpace=wrap;html=1;fixedSize=1;fillColor=#e1d5e7;strokeColor=#9673a6;fontColor=#4a2d5e;fontSize=12;shadow=1;" vertex="1" parent="g2">
          <mxGeometry x="40" y="110" width="180" height="50" as="geometry"/>
        </mxCell>
        <mxCell id="n7" value="NLP / CV" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#e1d5e7;strokeColor=#9673a6;fontColor=#4a2d5e;fontSize=12;shadow=1;arcSize=8;" vertex="1" parent="g2">
          <mxGeometry x="40" y="180" width="180" height="50" as="geometry"/>
        </mxCell>
        <mxCell id="e6" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;strokeWidth=2;strokeColor=#9673a6;exitX=0.5;exitY=1;exitDx=0;exitDy=0;entryX=0.5;entryY=0;entryDx=0;entryDy=0;" edge="1" source="n5" target="n6" parent="g2">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="e7" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;strokeWidth=2;strokeColor=#9673a6;exitX=0.5;exitY=1;exitDx=0;exitDy=0;entryX=0.5;entryY=0;entryDx=0;entryDy=0;" edge="1" source="n6" target="n7" parent="g2">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <!-- CONTAINER 3: Green (SAME height=280) -->
        <mxCell id="g3" value="实践项目" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#f0faf0;strokeColor=#82b366;fontColor=#2d5016;dashed=1;strokeWidth=1;verticalAlign=top;fontStyle=1;fontSize=13;spacingTop=8;" vertex="1" parent="1">
          <mxGeometry x="660" y="160" width="260" height="280" as="geometry"/>
        </mxCell>
        <mxCell id="n8" value="Kaggle竞赛" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;fontColor=#2d5016;fontSize=12;shadow=1;arcSize=8;" vertex="1" parent="g3">
          <mxGeometry x="40" y="40" width="180" height="50" as="geometry"/>
        </mxCell>
        <mxCell id="n9" value="开源贡献" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;fontColor=#2d5016;fontSize=12;shadow=1;arcSize=8;" vertex="1" parent="g3">
          <mxGeometry x="40" y="110" width="180" height="50" as="geometry"/>
        </mxCell>
        <mxCell id="n10" value="论文复现" style="shape=document;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;fontColor=#2d5016;fontSize=12;boundedLbl=1;backgroundOutline=1;size=0.27;" vertex="1" parent="g3">
          <mxGeometry x="40" y="180" width="180" height="60" as="geometry"/>
        </mxCell>
        <mxCell id="e8" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;strokeWidth=2;strokeColor=#82b366;exitX=0.5;exitY=1;exitDx=0;exitDy=0;entryX=0.5;entryY=0;entryDx=0;entryDy=0;" edge="1" source="n8" target="n9" parent="g3">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="e9" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;strokeWidth=2;strokeColor=#82b366;exitX=0.5;exitY=1;exitDx=0;exitDy=0;entryX=0.5;entryY=0;entryDx=0;entryDy=0;" edge="1" source="n9" target="n10" parent="g3">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <!-- ROOT → CONTAINERS (staggered exits, NO cross-container) -->
        <mxCell id="e1" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;strokeWidth=3;strokeColor=#333333;exitX=0.25;exitY=1;exitDx=0;exitDy=0;entryX=0.5;entryY=0;entryDx=0;entryDy=0;" edge="1" source="n1" target="g1" parent="1">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="e2" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;strokeWidth=3;strokeColor=#333333;exitX=0.5;exitY=1;exitDx=0;exitDy=0;entryX=0.5;entryY=0;entryDx=0;entryDy=0;" edge="1" source="n1" target="g2" parent="1">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="e3" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;strokeWidth=3;strokeColor=#333333;exitX=0.75;exitY=1;exitDx=0;exitDy=0;entryX=0.5;entryY=0;entryDx=0;entryDy=0;" edge="1" source="n1" target="g3" parent="1">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
```

## CRITICAL DESIGN PRINCIPLES
1. **Shape variety**: Use at least 3 different shapes in every diagram
2. **Color coding**: Each logical group gets its own color from the palette
3. **Uniform containers**: ALL containers in same row MUST be the SAME height
4. **Edge clarity**: Only root→container and intra-container edges. NEVER cross containers.
5. **Visual hierarchy**: Root = largest + boldest, containers = medium, children = standard
6. **Generous spacing**: min 40px gap between containers, min 20px between children
7. **Alignment**: Container tops aligned, children left-aligned inside containers

## EDIT MODE
If <existing_code> is present, modify the existing diagram. Preserve IDs. Output COMPLETE XML.

Respond in the same language as the user. Output ONLY design_concept and code tags.
"""


async def drawio_agent_node(state: AgentState) -> dict:
    """Generate or edit Draw.io mxGraph XML from user request."""
    llm = create_llm_for_agent(state, "drawio")
    response = await llm.ainvoke(
        [SystemMessage(content=SYSTEM_PROMPT)] + list(state["messages"])
    )
    return {"messages": [AIMessage(content=response.content)]}
