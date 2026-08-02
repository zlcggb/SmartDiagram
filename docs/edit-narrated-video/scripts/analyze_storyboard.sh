#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 || $# -gt 5 ]]; then
  echo "Usage: $0 INPUT_VIDEO OUTPUT_DIR [INTERVAL_SECONDS] [START] [END]" >&2
  exit 2
fi

input_video=$1
output_dir=$2
interval_seconds=${3:-4}
start_time=${4:-}
end_time=${5:-}

command -v ffmpeg >/dev/null || { echo "ffmpeg is required" >&2; exit 1; }
command -v ffprobe >/dev/null || { echo "ffprobe is required" >&2; exit 1; }
[[ -f "$input_video" ]] || { echo "Input video not found: $input_video" >&2; exit 1; }

mkdir -p "$output_dir"
ffprobe -v error -show_streams -show_format -of json "$input_video" > "$output_dir/metadata.json"

storyboard_command=(ffmpeg -y -hide_banner -loglevel error -i "$input_video")
[[ -n "$start_time" ]] && storyboard_command+=( -ss "$start_time" )
[[ -n "$end_time" ]] && storyboard_command+=( -to "$end_time" )
storyboard_command+=(
  -vf "fps=1/${interval_seconds},scale=720:-2,tile=4x4:padding=8:margin=8"
  "$output_dir/storyboard-%03d.jpg"
)
"${storyboard_command[@]}"

freeze_command=(ffmpeg -hide_banner -loglevel info -i "$input_video")
[[ -n "$start_time" ]] && freeze_command+=( -ss "$start_time" )
[[ -n "$end_time" ]] && freeze_command+=( -to "$end_time" )
freeze_command+=( -vf "scale=960:-2,freezedetect=n=-45dB:d=2" -an -f null - )
"${freeze_command[@]}" 2> "$output_dir/freeze-full.log" || true

if command -v rg >/dev/null; then
  rg 'freeze_(start|end|duration)' "$output_dir/freeze-full.log" > "$output_dir/freeze.log" || true
else
  grep -E 'freeze_(start|end|duration)' "$output_dir/freeze-full.log" > "$output_dir/freeze.log" || true
fi

echo "Metadata: $output_dir/metadata.json"
echo "Storyboards: $output_dir/storyboard-*.jpg"
echo "Freeze events: $output_dir/freeze.log"
