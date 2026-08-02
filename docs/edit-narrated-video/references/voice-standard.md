# Chinese course voice standard

Use this standard when the user wants the approved young Chinese female course voice.

## Fixed synthesis profile

- Voice: `Leda`
- Model: repository `TTS_DEFAULT_MODEL`
- Language: `cmn-CN`
- Recording unit: one continuous TTS request for all adjacent pages in the current approval batch
- Delivery: 48 kHz mono AAC or WAV

Before synthesis, also read [tts-batching-and-rendering.md](tts-batching-and-rendering.md). For the current repository endpoint, keep `input.text` under the observed 4000 UTF-8 byte ceiling, target no more than 3200 bytes, and keep predicted speech at or below about 90 seconds. Prefer 1–2 regular pages per continuous take; group 3 only when the pages are short.

Use this director prompt without independently rewriting it for each page:

> Audio Profile: 22至25岁的年轻成年中文女声，清甜、自然、有灵气，音色明亮柔和；带一点少女感，但不要幼态、撒娇或夹子音。 Scene: 像一位年轻、有耐心的知识类内容创作者，近距离、放松地向零基础观众讲解AI课程。 Consistency: 这是一次连续录音。必须从头到尾保持完全相同的声线、年龄感、音高区间、气息、语速、情绪强度和麦克风距离；后续段落绝对不要更换音色。 Director's Notes: 语速自然，吐字清楚，句尾轻收，关键概念略微加重。相邻页面之间安静停顿至少1.5秒。不要朗读页码、段落标签或任何导演说明。严格朗读正文，不增删内容。

## Consistency procedure

1. Concatenate the approved adjacent page scripts with blank-line boundaries.
2. Send the batch in one TTS request. Do not send caption phrases separately.
3. Detect page-boundary silence from the returned waveform and split at the silence midpoint.
4. Apply two-pass `loudnorm` separately to each delivered page: `I=-16`, `TP=-1.5`, `LRA=7`.
5. Verify each page reports exactly `-16.0 LUFS` integrated loudness, true peak at or below `-1.5 dBFS`, 48 kHz, mono, and complete decode.
6. Keep the continuous review file so the user can hear whether page transitions preserve the same timbre.
7. After approval, transcribe or force-align the final normalized audio for captions and focus timing. Never reuse timestamps from a superseded take.
8. If a group returns HTTP 504, split the group and retry the exact original text. If the provider reports a usage false positive, retry once and then reduce the exact-text unit; do not silently rewrite the script.

## Immutable synthesis fingerprint

After the user approves the sample, freeze and record all of the following in the build manifest:

- provider/base URL identifier;
- model, voice, and language code;
- the exact UTF-8 bytes and SHA-256 hash of the director prompt;
- response format, sample rate, channel count, and loudness targets;
- the approved continuous reference-master path and checksum.

Require the same fingerprint for every later request. Whitespace and punctuation in the director prompt are part of the fingerprint. Never switch to a shortened fallback prompt merely because an upstream request is rejected.

## Voice and pace gate

Use the approved continuous master as the acoustic anchor. Run this gate on raw TTS audio before loudness normalization and again on the finished page before rendering:

1. Force-align the exact narration and measure **active speech duration** from aligned words, excluding leading/trailing silence and deliberate page gaps.
2. Compute active-speech characters per second using Han characters plus spoken Latin letters/digits. Compare a page with the approved anchor and with adjacent accepted pages of similar sentence length.
3. Reject a page when its active-speech rate is more than 15% slower or faster than the approved anchor median. Reject an individual phrase when it differs from the page median by more than 12%, unless punctuation clearly calls for a deliberate pause.
4. Measure median voiced pitch on non-silent frames. Reject a page or phrase whose median differs by more than 10% from the approved-anchor median. Treat a sudden within-page jump as a failure even if the page-wide median passes.
5. When a stable speaker-embedding model is available, calibrate its threshold using several internal splits of the approved master; reject candidates outside that reference distribution. Do not use an arbitrary universal cosine threshold.
6. Keep loudness around `-16 LUFS`, but do not mistake loudness equality for voice equality. Equal LUFS cannot repair different timbre, pitch, breath, or delivery.

Fail closed: regenerate the whole affected page with the immutable fingerprint. Do not repair a slow or mismatched take with `atempo`, `asetrate`, pitch shifting, time stretching, formant shifting, or Remotion `playbackRate`.

## Technical-term pronunciation

Keep subtitle spelling and TTS pronunciation as two fields:

- `displayText`: exact editorial wording shown in the video and SRT;
- `spokenText`: pronunciation-normalized text sent to TTS and used for force alignment.

Build a per-project pronunciation dictionary before batch generation. For a Chinese teaching voice, prefer natural Chinese terminology where it is conventional (`Agent` → `智能体`, `Prompt` → `提示词`) and explicit letter readings for abbreviations (`API` → `A、P、I`, `RAG` → `R、A、G`, `LLM` → `L、L、M`, `MCP` → `M、C、P`, `OCR` → `O、C、R`, `PDF` → `P、D、F`). Split model names only where needed (`Qwen3-VL` → `通义千问三，V、L`; `GLM-5V` → `G、L、M，五 V`). Preserve product names such as Kimi, LangChain, LangGraph, and LangSmith with punctuation or spacing that encourages one stable reading.

Apply the dictionary deterministically to every page before sending any request. Do not improvise a different reading on later pages. Force-align against `spokenText`, then write the resulting intervals back to `displayText`; otherwise corrected pronunciation will look like an audio/subtitle mismatch even when the speech is right.

## Granularity rule

- Preferred: one continuous request for 1–2 adjacent pages.
- Acceptable fallback: one complete page with the same immutable fingerprint.
- Review-only fallback: semantic paragraphs, only when a full page cannot be generated. Do not put this result into the final video without explicit user approval after a continuous listen.
- Forbidden for final delivery: independently synthesized caption phrases or short sentences stitched into a page. Even with one named voice, stochastic generations can change pace, pitch, age impression, breath, and microphone distance at every join.

## Approval gate

Generate only the first two pages first. Do not synthesize the remaining pages or render the full deck until the user approves both the voice sample and the two-page video sample.
