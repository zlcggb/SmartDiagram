#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 || $# -gt 5 ]]; then
  echo "Usage: $0 OUTPUT_VIDEO QA_DIR [INTERVAL_SECONDS] [START] [END]" >&2
  exit 2
fi

output_video=$1
qa_dir=$2
interval_seconds=${3:-4}
start_time=${4:-}
end_time=${5:-}
script_dir=$(cd "$(dirname "$0")" && pwd)

command -v ffmpeg >/dev/null || { echo "ffmpeg is required" >&2; exit 1; }
command -v ffprobe >/dev/null || { echo "ffprobe is required" >&2; exit 1; }
[[ -f "$output_video" ]] || { echo "Output video not found: $output_video" >&2; exit 1; }

mkdir -p "$qa_dir"
audio_index=$(ffprobe -v error -select_streams a:0 -show_entries stream=index -of csv=p=0 "$output_video")
[[ -n "$audio_index" ]] || { echo "Validation failed: no audio stream" >&2; exit 1; }

ffprobe -v error -show_streams -show_format -of json "$output_video" > "$qa_dir/output-metadata.json"
ffmpeg -hide_banner -loglevel error -i "$output_video" -map 0:v:0 -map 0:a:0 -f null -
echo "decode_ok" > "$qa_dir/decode.ok"

video_duration=$(ffprobe -v error -select_streams v:0 -show_entries stream=duration -of default=noprint_wrappers=1:nokey=1 "$output_video")
audio_duration=$(ffprobe -v error -select_streams a:0 -show_entries stream=duration -of default=noprint_wrappers=1:nokey=1 "$output_video")
frame_rate=$(ffprobe -v error -select_streams v:0 -show_entries stream=avg_frame_rate -of default=noprint_wrappers=1:nokey=1 "$output_video")

duration_check=$(awk -v vd="$video_duration" -v ad="$audio_duration" -v rate="$frame_rate" '
  BEGIN {
    if (vd == "" || ad == "" || vd == "N/A" || ad == "N/A") {
      print "unavailable";
      exit 2;
    }
    split(rate, parts, "/");
    fps = (parts[2] + 0 == 0) ? 0 : parts[1] / parts[2];
    tolerance = (fps > 0) ? 1 / fps : 0.05;
    diff = vd - ad;
    if (diff < 0) diff = -diff;
    printf "video=%.6fs audio=%.6fs diff=%.6fs tolerance=%.6fs", vd, ad, diff, tolerance;
    exit(diff > tolerance ? 1 : 0);
  }
') || duration_status=$?
duration_status=${duration_status:-0}
printf '%s\n' "$duration_check" > "$qa_dir/duration-check.txt"
if [[ $duration_status -eq 1 ]]; then
  echo "Validation failed: audio/video duration difference exceeds one frame ($duration_check)" >&2
  exit 1
elif [[ $duration_status -eq 2 ]]; then
  echo "Warning: stream durations unavailable; inspect output-metadata.json" >&2
fi

ffmpeg -hide_banner -i "$output_video" -map 0:a:0 -af volumedetect -f null - \
  2> "$qa_dir/volume.log" || true
ffmpeg -hide_banner -i "$output_video" -map 0:a:0 -af silencedetect=n=-38dB:d=0.18 -f null - \
  2> "$qa_dir/silence.log" || true

if [[ -n "$start_time" || -n "$end_time" ]]; then
  "$script_dir/analyze_storyboard.sh" "$output_video" "$qa_dir/storyboard" "$interval_seconds" "$start_time" "$end_time"
else
  "$script_dir/analyze_storyboard.sh" "$output_video" "$qa_dir/storyboard" "$interval_seconds"
fi

echo "Validation passed: $output_video"
echo "QA artifacts: $qa_dir"
