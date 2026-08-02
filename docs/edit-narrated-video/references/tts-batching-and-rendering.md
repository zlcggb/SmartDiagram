# TTS batching and video assembly

Use these limits for the repository endpoint and `gemini-3.1-flash-tts-preview`. They are production observations from 2026-08, not universal limits for every provider.

## Request sizing

Treat voice-generation batches and video-render batches as separate units.

| Constraint | Rule |
|---|---|
| Upstream hard text limit | Keep `Buffer.byteLength(text, "utf8") < 4000`. The observed service rejects a larger `input.text`. |
| Operational text budget | Target at most 3200 UTF-8 bytes so punctuation and retries have headroom. |
| Predicted voice duration | Target at most 90 seconds per TTS request. Successful continuous masters were about 84–91 seconds; a four-page group timed out with HTTP 504. |
| Normal page group | Use 1–2 adjacent pages. Use 3 only when chapter pages are short and predicted output remains under 90 seconds. |
| Parallel TTS | Use 3 concurrent groups by default. Do not exceed the configured service limit. |
| Client timeout | Allow up to 900 seconds locally, while recognizing that an upstream gateway may still return 504 earlier. |

Estimate duration conservatively at 4–5 spoken Chinese characters per second plus punctuation pauses. The estimate is only for batch sizing; always measure the returned waveform.

Before a request, record:

```js
const utf8Bytes = Buffer.byteLength(text, "utf8");
const estimatedSeconds = chineseCharacterCount / 4.5 + punctuationPauseSeconds;
```

Reject or split locally when `utf8Bytes >= 4000` or `estimatedSeconds > 90`.

Create `displayText` and `spokenText` before request sizing. Count and send `spokenText`, because expanded letter readings can be longer than the visible subtitle. Store both in the manifest together with a deterministic pronunciation dictionary and its version/hash.

## Retry tree

1. Generate the approved adjacent group with one fixed voice and director prompt.
2. On HTTP 504, split the page group in half and retry the exact original text.
3. On a usage-guideline false positive, retry the exact request once; then reduce to smaller exact-text page units.
4. Never rewrite narration to bypass a rejection without explicit user approval.
5. Never change or shorten the approved director prompt during fallback. Verify its saved SHA-256 fingerprint before every retry.
6. Never reduce a final deliverable to caption-sized or sentence-sized TTS calls. If the smallest complete-page request still fails, stop that page, preserve the failure record, and regenerate later or request user review. Phrase-level synthesis is review-only and must not silently enter the final timeline.
7. If exact-text local audio already exists, accept it only when it came from an approved page/multi-page take and passes the current acoustic gate. Do not reuse a folder of unrelated phrase takes merely because the text matches.
8. Preserve every successful continuous master; do not regenerate it merely because a neighboring group failed.

Use at least 1.5 seconds of deliberate page-boundary silence in a continuous master. Detect the boundary in the returned waveform and split at the silence midpoint. Do not split by character ratio.

## Audio finishing

For each delivered page:

1. Decode the selected range to 48 kHz mono PCM.
2. Apply two-pass EBU R128 normalization: `I=-16`, `TP=-1.5`, `LRA=7`.
3. Encode 48 kHz mono AAC at 160 kbps or retain WAV for an intermediate.
4. Measure the result again. Accept approximately `-16 LUFS` and true peak no higher than `-1.5 dBTP`.
5. Decode the entire file and force-align captions from this final waveform.

Use the exact `spokenText` for alignment, but retain `displayText` in the plan and SRT. Normalize harmless ASR variants before edit-distance gating: NFKC, case, punctuation, traditional/simplified Chinese, and compact-versus-separated Latin letters. These normalizations are alignment-only and must never rewrite the editorial subtitle.

Do not use pitch shifting to hide a changed voice. Record pitch or spectral outliers for review and regenerate the affected page when possible.

Do not use time-domain correction either. Ban `atempo`, `asetrate`, rubber-band/time stretching, formant shifting, and playback-rate changes from final narration. The video, captions, and focus events must inherit the measured natural audio duration.

## Acoustic acceptance before render

Use the approved first-page/two-page continuous master as the anchor. For every candidate page:

- force-align the exact text and calculate rate from active speech, not total file duration;
- require page rate within ±15% of the approved-anchor median;
- require any contiguous phrase rate within ±12% of the page median unless an intentional punctuation pause explains it;
- require median voiced pitch within ±10% of the approved anchor and reject abrupt within-page pitch jumps;
- compare a calibrated speaker embedding when available;
- require the exact synthesis-fingerprint hash to match;
- run the gate before Remotion rendering and fail the batch if any page fails.

Loudness normalization is permitted because it changes level, not delivery timing. Trimming page-boundary silence and resampling to 48 kHz mono are permitted. None of these operations should be used to conceal a rejected voice or pace result.

## Render batching

Render 5–7 pages per Remotion composition so batches can run concurrently and be retried independently. A render batch may contain several smaller TTS groups; it does not imply one long TTS request.

For every batch use identical delivery parameters:

- 1920×1080, 30 fps;
- H.264 High, `yuv420p`;
- AAC LC, 48 kHz stereo at the muxed-video layer;
- matching stream time bases;
- `+faststart` on the final delivery.

Compute page and batch duration from frames:

```text
pageFrames = round(measuredPageDurationMs / 1000 * fps)
pageDurationMsOnTimeline = pageFrames / fps * 1000
batchFrames = sum(pageFrames)
```

Accumulate SRT offsets from `pageFrames`, not from unrounded source milliseconds. This prevents small per-page rounding errors from becoming boundary drift.

## Assemble without re-encoding

Before concat-copy, compare all inputs with `ffprobe`:

- video codec, profile, pixel format, width, height, frame rate, and time base;
- audio codec, sample rate, channel count/layout, and time base.

If any item differs, normalize that batch to the canonical delivery profile before concatenation. Otherwise use the FFmpeg concat demuxer and `-c copy`.

After assembly:

1. Decode the complete MP4 with `ffmpeg -v error -i final.mp4 -f null -`.
2. Confirm the encoded duration matches accumulated frame duration within codec padding.
3. Measure integrated loudness and true peak for the whole program.
4. Extract frames at every batch join and at the first, middle, and last dense slide.
5. Validate the SRT is monotonic, has no negative durations, and ends at the planned final frame.
