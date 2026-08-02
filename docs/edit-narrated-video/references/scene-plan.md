# Scene plan and synchronization reference

## Scene schema

Keep one ordered record per semantic state:

```json
{
  "id": "svg-generation",
  "sourceStart": 146.2,
  "sourceEnd": 167.8,
  "narration": "进入设计出图阶段，系统正在为当前页面生成 SVG 设计稿。",
  "audioPath": "voice-08a.mp3",
  "audioDuration": 6.528,
  "gap": 0.35,
  "captionPath": "caption-08.png",
  "focus": {
    "anchors": ["正在生成 SVG"],
    "targetShapeIds": ["s8:14"],
    "containerShapeId": null,
    "box": {"x": 0.21, "y": 0.34, "w": 0.58, "h": 0.22}
  }
}
```

The semantic fields identify the target; the box is a derived value. For PPTX slide videos, generate it with `scripts/focus_boxes.py` and keep the corresponding QA report. Do not store an unaudited coordinate guess.

Derived values:

```text
outputDuration = audioDuration + gap
retimeRatio = outputDuration / (sourceEnd - sourceStart)
captionStart = cumulative previous outputDuration
captionEnd = captionStart + audioDuration
```

## Scene audit table

Before synthesis, maintain a table like this:

| Scene | Source range | Visible state | Narration claim | Start/mid/end verified |
|---|---:|---|---|---|
| svg-generation | 146.2–167.8 | code canvas loading/generating | SVG design is being generated | yes |
| theme-preview | 167.8–177.8 | finished slide and theme changes | switch theme/color/background | yes |
| director-settings | 177.8–181.0 | voice and subtitle controls | select voice/style/concurrency | yes |

If the visible state column contains two meanings, split the scene.

## FFmpeg composition pattern

For scene `i`:

```text
[0:v]trim=start=SOURCE_START:end=SOURCE_END,
 setpts=RATIO*(PTS-STARTPTS),
 scale=1920:1080:force_original_aspect_ratio=decrease,
 pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,
 setsar=1,fps=30[v_i]

[caption_i:v]format=rgba[c_i]
[v_i][c_i]overlay=0:H-h-70:
 enable='between(t,0,AUDIO_DURATION)'[vo_i]

[audio_i:a]apad=pad_dur=GAP,
 atrim=duration=OUTPUT_DURATION,
 asetpts=PTS-STARTPTS[a_i]
```

Concatenate alternating video/audio labels:

```text
[vo_0][a_0][vo_1][a_1]...concat=n=SCENE_COUNT:v=1:a=1[vout][aout]
```

Encode with `libx264`, `yuv420p`, AAC, and `-movflags +faststart`.

## Boundary selection rules

1. Find the first frame where the narration claim becomes visibly true.
2. End before the first frame where another claim becomes true.
3. Sample every 0.5–1 second around that boundary.
4. For a very short but important settings state, slow a stable range instead of including unrelated later frames.
5. Keep loading and completed-result states separate even when they occupy the same page.

## Failure modes learned from production

| Failure | Root cause | Corrective action |
|---|---|---|
| Voice changes between captions or pages | Caption phrases synthesized as independent TTS requests | Generate adjacent review pages as one continuous take, then split at measured silence |
| Caption and voice drift | Character-weight timing or timestamps reused from an older take | Transcribe or force-align the approved final waveform; never estimate by text length |
| Caption matches voice but not screen | Scene covers multiple semantic UI states | Split at the visible state transition |
| Settings narration appears on design view | Source range begins before navigation completes | Move the source start to the first settings frame |
| Result narration appears during loading | Loading and result treated as one scene | Create separate generation and result scenes |
| Midpoint looks correct but edges are wrong | Only scene midpoint was reviewed | Inspect start, midpoint, end, and dense boundary frames |
| New video uses stale MP3/SRT | Assets were reused after script changes | Version or regenerate every dependent artifact |
| Focus box clips or misses text | Coordinates were estimated visually or one anchor represented a multi-shape block | Select exact PPTX shape/table-cell IDs, union their geometry, add bounded padding, and fail generation-time QA below 98% coverage |
| Focus box is much too large | A whole column/card was guessed for a sentence-level target | Use exact text mode, enforce tightness, and split spatially separate targets |
| Subtitle crosses the focus box | Caption was animated continuously from bottom to an improvised raised position | Cross-fade between fixed bottom and top caption rails before collision |

## Final synchronization audit

- Verify every subtitle text equals its scene narration.
- Verify the review batch used one TTS request and a fixed voice/director prompt.
- Verify every delivered page measures `-16 LUFS` integrated loudness and no higher than `-1.5 dBTP` true peak.
- Verify every audio input index maps to the same scene index.
- Verify caption input offsets after adding or removing scenes.
- Verify cumulative SRT times use measured durations and gaps.
- Extract a contact sheet at each scene midpoint.
- Extract a second contact sheet across every changed boundary.
- Verify every focus event records its target IDs and passes coverage, tightness, edge, and unrelated-text checks before frame rendering.
- Decode the complete MP4, not only a preview clip.
