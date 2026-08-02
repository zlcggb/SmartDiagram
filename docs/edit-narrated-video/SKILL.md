---
name: edit-narrated-video
description: Edit screen recordings, demos, and slide decks into synchronized narrated deliverables with scene-based timing, TTS voiceover, burned subtitles, Remotion focus effects, and H.264/AAC export. Use when Codex needs to cut or retime a video, turn a PPT or silent recording into an explainer, add Chinese or other narration and captions, repair audio/subtitle/visual drift, or reproduce a reliable narrated-video production pipeline.
---

# Edit Narrated Video

Produce a concise video in which the visible UI state, spoken sentence, and burned caption describe the same event at the same time.

## Non-negotiable rule

Use a scene plan as the single source of truth. Never generate one long narration and estimate subtitle or scene boundaries by character count.

Separate **voice generation granularity** from **caption granularity**. Generate adjacent approved pages in one continuous TTS take to preserve timbre; create short captions later from timestamps measured on that final audio. Never synthesize every caption phrase independently when voice consistency matters.

For every scene, record:

- exact source start and end;
- one narration idea tied to what is visibly happening;
- one audio file;
- measured audio duration;
- output gap and caption interval.

Set `scene output duration = measured audio duration + gap`. Derive both video retiming and subtitle timing from that value.

## Workflow

### 1. Preserve and inventory the source

- Keep the original file unchanged.
- Probe streams, dimensions, frame rate, duration, and audio presence with `ffprobe`.
- Run `scripts/analyze_storyboard.sh` before writing narration.
- Use a 2–4 second storyboard interval for orientation. Re-run with a 0.5–1 second interval around transitions.
- Treat freeze detection as evidence of inactivity, not proof that a segment should be cut.
- If the folder contains a PPTX and narration but no source video, render every slide to a 16:9 image sequence and build the video from those images. Do not raster-edit or overwrite the source deck.

### 2. Build the semantic timeline

Create a scene table before editing. See `references/scene-plan.md` for the schema and audit rules.

Split scenes whenever the meaning of the screen changes, especially:

- loading versus completed result;
- editor versus preview;
- design view versus director/settings view;
- settings versus per-item playback;
- export in progress versus export history versus final preview.

Do not let a sentence describe a control, result, or page before it is visible. Inspect the beginning, midpoint, and end of every proposed source range.

### 3. Write scene-bound narration

- Use one visible action or state per scene.
- Name the current state before its consequence: “正在生成 SVG” before “切换主题”。
- Keep wording concrete and demonstrable from the frame.
- Avoid feature-list narration when the video shows a process; explain the transition instead.
- If using an external TTS service, obtain authorization before sending text and never print API keys.
- Keep `displayText` and `spokenText` separate when the script contains technical English. `displayText` is the exact subtitle; `spokenText` may expand letters or replace a borrowed term with its approved Chinese reading. Never leak the pronunciation markup into the burned subtitle or SRT.

### 4. Generate a voice-consistent approval batch

- Read [references/voice-standard.md](references/voice-standard.md) before generating Chinese course narration.
- Read [references/tts-batching-and-rendering.md](references/tts-batching-and-rendering.md) before sizing TTS requests or parallel render batches.
- Keep voice, model, language, and director prompt identical across the batch.
- Freeze an immutable request fingerprint after approval: provider/base URL, model, voice, language, the exact director-prompt bytes, response format, and audio post-processing settings. Save it in the manifest and compare its hash before every request. Do not shorten, paraphrase, or otherwise change the approved director prompt for a retry.
- Prefer the repository's existing TTS client and configured environment variables such as `TTS_API_KEY`, `TTS_API_BASE_URL`, `TTS_DEFAULT_MODEL`, `TTS_DEFAULT_VOICE`, and `TTS_LANGUAGE_CODE`.
- Treat an explicit request to add or regenerate voiceover as authorization to call that configured TTS service. Ask only when the service, cost, or data destination is unclear.
- Load secrets without echoing them, keep them out of commands and logs, and never copy `.env` into the skill or generated deliverables.
- Generate the smallest user-approved review range first, normally the first two pages. Send those adjacent pages in **one TTS request as one continuous take**, then split the returned master only at the detected page-boundary silence.
- For this repository endpoint, enforce both request limits before sending: less than 4000 UTF-8 text bytes and no more than about 90 seconds predicted speech. Target at most 3200 bytes and normally 1–2 adjacent pages. Treat these as endpoint-specific production limits, not universal TTS limits.
- On HTTP 504, split the group and retry exact original text. On an upstream usage false positive, retry once and then reduce the exact-text unit. Never rewrite narration to bypass a rejection without explicit approval.
- Keep each final TTS unit at page or multi-page granularity. Do not assemble a deliverable page from independently synthesized caption phrases or short sentences. If the provider rejects a whole page after exact retries, quarantine that page for regeneration or user review; do not silently fall back to phrase-level synthesis.
- Preserve the approved master and move superseded takes to an archive folder.
- Read the real duration from the returned master and every split with `ffprobe`, `music-metadata`, or an equivalent parser.
- Store durations in seconds or milliseconds; do not infer them from text length.
- Normalize every delivered page with two-pass EBU R128 loudness normalization to `-16 LUFS`, `-1.5 dBTP`, `LRA 7`, 48 kHz mono. Verify the measured result, not merely the command options.
- Treat loudness normalization, channel/sample-rate conversion, boundary-silence trimming, and lossless splitting as the only routine audio finishing. Never use `atempo`, `asetrate`, pitch shifting, time stretching, Remotion `playbackRate`, or equivalent processing to make narration fit a visual duration. Extend or retime the visuals to the approved natural audio instead.
- Compare every generated page with the approved reference take before rendering. Measure active-speech rate from aligned words, median voiced pitch, loudness, and—when available—speaker-embedding distance. Reject and regenerate an outlier rather than correcting it in post. See `references/voice-standard.md` for gates.
- Do not generate the rest of the deck until the user approves the voice sample.

### 5. Generate captions from the same scene data

- Transcribe or force-align the **approved final audio** locally to obtain token or phrase timestamps. Do not reuse timing from an earlier take.
- Use the narration text for correction, but keep timestamps from the final waveform. Never estimate caption or focus timing from character count.
- Keep caption and focus events in the same timing record so the displayed sentence and highlighted region share one interval.
- Prefer a compact single-line caption in a bottom-safe area.
- When FFmpeg lacks `libass` or `drawtext`, render transparent caption PNGs with a licensed font and overlay them with `enable='between(t,start,end)'`.
- Keep the SRT sidecar even when captions are burned into the video.
- When captions may move between top and bottom safe rails, choose exactly one rail for the entire caption interval (normally from the focus box at the caption midpoint) and render exactly one caption node. Never cross-fade two duplicate caption nodes between rails; both become visible during the transition.

### 6. Retime and compose

For each scene:

1. Trim the exact source range.
2. Compute `ratio = outputDuration / (sourceEnd - sourceStart)`.
3. Apply `setpts=ratio*(PTS-STARTPTS)` to the video.
4. Pad and trim audio to `outputDuration`.
5. Overlay the scene caption only through the measured voice duration.
6. Concatenate scene video/audio pairs in order.

The audio is the timing authority. Never compress or stretch approved narration to hit a preselected scene duration; change the scene frames, caption intervals, and focus intervals instead.

Export with H.264 High, `yuv420p`, AAC, a stable frame rate, and `+faststart`. Use 1920×1080 at 30 fps unless the user requests another format.

For slide-based explainers, Remotion is a good composition layer:

- keep a JSON scene plan as the source for slide order, phrase audio, measured durations, captions, gaps, and focus presets;
- read [references/focus-box-localization.md](references/focus-box-localization.md) before generating focus events;
- when a PPTX or other structured source exists, run `scripts/focus_boxes.py extract` and derive focus geometry from real shape or table-cell bounds; let semantic reasoning select exact anchors or shape IDs, never raw coordinates;
- treat PPT shape bounds as candidates, not final glyph bounds. Refine selected text targets against OCR line boxes from the rendered slide whenever the shape contains multiple paragraphs, a loose text placeholder, or a table/card container;
- store `anchors`, `targetShapeIds`, optional `containerShapeId`, and the derived normalized box in every focus event;
- run `scripts/focus_boxes.py resolve --fail-on-qa` before rendering. Reject boxes that clip selected text, touch an unapproved edge, are excessively loose, or swallow unrelated text;
- use `Sequence` for slide and phrase timing, `staticFile()` for slide/audio assets, and measured duration to calculate every sequence length;
- use slow camera transforms for viewport focus, a dimmed outside shadow plus a restrained outline for local emphasis, and animated SVG paths for hand-drawn underlines;
- define focus boxes in the logical 1920×1080 canvas so camera, outline, and underline move together;
- render representative keyframes from the opening, dense middle pages, learning-path page, and closing page before starting the full encode.
- after rendering, extract the midpoint frame of **every** focus event into per-page contact sheets. A sampled storyboard is not sufficient when boxes were regenerated; visually inspect all events and retain the contact-sheet report.
- keep the whole slide visible by default; use a restrained highlight, underline, or outline before considering camera movement;
- allow a camera move only when its exact start and end are bound to aligned narration timestamps and the target remains fully inside frame;
- render and review only the approved first two pages before scaling to the rest of the deck.

When a long Remotion composition contains hundreds of audio clips, protect disk space:

- point `TMPDIR` at a data volume with ample free space before rendering;
- if Remotion audio preprocessing would create excessive temporary WAV files, render a muted H.264 video track and build a frame-aligned AAC timeline separately;
- pad each phrase to `ceil(realAudioDuration × fps)` frames, append its configured gap, and append the page gap before concatenating;
- mux with `-c:v copy -c:a copy -movflags +faststart`, then verify audio/video duration differs by no more than one frame.

For parallel production, keep TTS groups small but render 5–7 pages per composition. Render batches concurrently only after their plans pass audio, caption, and focus-box QA. Use frame-rounded page durations for composition length and cumulative SRT offsets. Concat-copy batches only when their complete video and audio stream parameters match.

### 7. Validate synchronization before delivery

Run `scripts/validate_output.sh` and perform all checks below:

- full decode completes without errors;
- video and audio durations differ by no more than one frame or codec padding;
- every scene midpoint shows the state named by its narration;
- every focus event covers at least 98% of its selected PPT/OCR text geometry and passes the focus-box QA report;
- transition boundaries are checked at 0.5–1 second resolution;
- reported problem windows are sampled every 1–2 seconds;
- loading, result, settings, playback, export, and preview captions appear only on matching states;
- audio is present and not silent or clipped.
- no final audio path contains speed, tempo, pitch, or time-stretch processing, and every delivered TTS unit passes the approved-reference voice/rate gate;
- every caption interval instantiates one visible caption node on one fixed rail; fail source audit if both top and bottom caption trees can coexist;

Distinguish three failures before fixing:

- **audio–caption mismatch:** spoken sentence differs from displayed sentence;
- **visual–content mismatch:** audio and caption agree, but the screen shows another state;
- **boundary drift:** the correct state appears, but too early or too late.

Fix the scene plan at the source. Do not hide a semantic mismatch by shifting the whole subtitle track.

### 8. Handoff cleanly

- Deliver the final MP4, narration audio, SRT, and editable narration text when useful.
- Use explicit names such as `-同步版` or `-narrated-synced`.
- Keep the original untouched.
- Move superseded generated versions into an `旧版` or `archive` folder instead of silently deleting user files.
- Report final duration, resolution, codecs, and what synchronization windows were inspected.

## Resources

- `scripts/analyze_storyboard.sh`: probe a source video, detect long freezes, and generate dense contact sheets for the whole file or a time window.
- `scripts/validate_output.sh`: decode the final file, inspect audio levels/silence, and generate QA contact sheets.
- `references/scene-plan.md`: scene-plan schema, FFmpeg composition pattern, and failure-mode checklist.
- `references/voice-standard.md`: fixed Chinese voice profile and consistency gate.
- `references/tts-batching-and-rendering.md`: endpoint request limits, retry tree, parallel rendering, concat, and frame-accurate SRT rules.
- `references/focus-box-localization.md`: structured geometry, OCR fallback, target selection, and automatic QA thresholds.
- `scripts/focus_boxes.py`: extract PPTX shape/table geometry and resolve semantic anchors into validated focus boxes.
