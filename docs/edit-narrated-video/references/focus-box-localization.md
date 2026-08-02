# Deterministic focus-box localization

Generate focus boxes from document geometry. Do not ask a language or vision model to invent normalized coordinates.

## Source priority

Use the first available source:

1. PPTX, SVG, HTML, or another structured source with element geometry;
2. PDF text spans and vector rectangles;
3. rendered-image OCR and layout detection;
4. manual coordinates only for unresolved decorative or raster-only regions.

The semantic model may select shape IDs or exact text anchors. Deterministic code must calculate `x`, `y`, `w`, and `h`.

## PPTX workflow

Run the bundled extractor:

```bash
python3 scripts/focus_boxes.py extract deck.pptx \
  --output geometry.json --width 1920 --height 1080
```

The extractor reads PresentationML/DrawingML transforms, nested groups, text shapes, and table cells. It emits stable IDs, text, z-order, EMU geometry, pixel geometry, and normalized geometry. If a placeholder lacks local geometry, it reports the item as unresolved instead of guessing; resolve it from the layout/master or use OCR.

For every narration focus event, create semantic targets:

```json
{
  "paddingPx": 14,
  "slides": [{
    "page": 5,
    "events": [{
      "startMs": 12000,
      "endMs": 26000,
      "anchors": [
        "B 端：企业级大模型（定制模型）",
        "经过专业训练的前台",
        "代价：需要建设知识库"
      ],
      "mode": "text"
    }]
  }]
}
```

Then resolve and validate:

```bash
python3 scripts/focus_boxes.py resolve \
  --candidates geometry.json \
  --targets focus-targets.json \
  --output focus-resolved.json \
  --report focus-qa.json \
  --fail-on-qa
```

Use exact `shapeIds` when an anchor is ambiguous. For table rows, select every cell ID in that row. Use `mode: "container"` only when the intended target is the whole card or panel; the resolver chooses the smallest containing shape and includes its contained text.

## Geometry rules

1. Resolve all exact anchor shapes.
2. Take the geometric union of the selected text boxes or table cells.
3. Add 10–18 px padding at 1920×1080; use 14 px by default.
4. For a card target, snap to the smallest valid containing rectangle and add about 6 px external padding.
5. Never reduce a box until any selected text is clipped.
6. Split a focus event when two intended regions are spatially separate; do not make one oversized box across unrelated columns.
7. Store `anchors`, `targetShapeIds`, optional `containerShapeId`, and the derived box in the scene plan so the geometry is auditable.

## Generation-time QA gates

Reject a focus event before rendering when any gate fails:

- selected-text coverage is below 98%;
- the focus box touches the slide edge without `allowEdge`;
- box tightness, defined as selected-union area divided by focus-box area, is below 0.35;
- the box contains an unrelated text shape by 50% or more, unless the event deliberately targets the parent container;
- the best semantic anchor score is below 0.58;
- two candidate shapes have nearly equal semantic scores and no explicit shape ID disambiguates them.

For critical dense slides, cross-check the derived box against the rendered slide. Flag the page when the PPTX geometry and raster text bounds differ by more than 8 px or 2% of the slide dimension.

PPT text placeholders and table parents are often much looser than the printed glyphs. For those targets, use the PPT geometry only to identify the semantic region, then intersect/refine it with matched OCR **line** boxes from the rendered slide. Do not use a parent `graphicFrame` as the final box when one or more table-cell/text-shape IDs are available. Apply adaptive padding small enough not to absorb an adjacent row or column.

Before rendering, require all intended events to resolve and pass geometry QA. After rendering, extract one midpoint frame for every event, tile them by page, and visually inspect the full set. Keep the machine report and the contact sheets together so an apparently valid numeric box cannot hide an origin-conversion or rendering-scale error.

## Raster-only fallback

When only an image exists, use OCR word boxes and layout grouping:

1. Run an accurate text recognizer and retain text, confidence, and normalized word boxes.
2. Convert coordinate origins explicitly. Apple Vision OCR uses normalized coordinates with a lower-left origin, so convert with `topY = 1 - y - h` before mapping to Remotion.
3. Group words into lines by vertical overlap, then group lines into blocks with XY-cut or distance-based clustering.
4. Match semantic anchors to OCR text; take the union of matched word/line boxes.
5. Detect surrounding card borders or background regions and snap only when the container is smaller than a conservative area multiple of the matched text.
6. Apply the same coverage, tightness, edge, and unrelated-text QA gates.

OCR boxes are guidance rather than exact glyph masks. If recognition confidence is low, matching is ambiguous, or the target is non-textual, require a rendered-frame review.

## Subtitle interaction

Focus localization and subtitle placement are separate constraints. Define two possible fixed caption rails:

- default bottom rail;
- top rail when a focus box enters the lower caption safe zone.

For each caption, evaluate collision from the focus box at the caption midpoint, select one rail, and keep that rail for the caption's full lifetime. Render a single caption element only. Never create simultaneous top and bottom copies and cross-fade their opacity: both copies are visible during the transition and appear as duplicate subtitles. Do not animate the caption through the focused region, and do not toggle the dimming layer while the focus box moves.
