"""AI 视觉分析教练 A/B 基准对比实验命令行评测脚本。

直接调用本地运行中的 http://localhost:4020/api/coach-lab/benchmark 接口，
对比：
  Group A (Baseline): 4 张独立视频帧裸图上传（复刻展会 Frigate-VL 方案）
  Group B (Ours)    : 单张 2×2 时序网格拼图 + 骨骼几何角度 JSON 注入（三步破局方案）
测试模型：
  gemini-3.8-flash-high / gemini-3.5-flash-lite
"""
from __future__ import annotations

import base64
import io
import json
import os
import urllib.request


def _generate_synthetic_action_frames() -> tuple[str, list[str], dict]:
    """用 Pillow 生成 4 张模拟人体深蹲/演讲体态动作的关键帧，以及合成后的 2x2 时序网格图。"""
    from PIL import Image, ImageDraw

    phases = [
        ("START", "00:08.0", 172, 6, (48, 209, 88)),
        ("LOAD", "00:08.4", 126, 14, (255, 214, 10)),
        ("APEX", "00:08.8", 84, 29, (255, 69, 58)),
        ("FINISH", "00:09.3", 168, 8, (48, 209, 88)),
    ]

    raw_b64_list: list[str] = []
    annotated_imgs: list[Image.Image] = []

    for idx, (label, ts, knee_deg, trunk_deg, color) in enumerate(phases, start=1):
        # 1. 生成未标注原图 (640x360) 供 Baseline 测试
        raw_img = Image.new("RGB", (640, 360), (238, 242, 246))
        d_raw = ImageDraw.Draw(raw_img)
        d_raw.rectangle([40, 290, 600, 340], fill=(215, 220, 228))
        crouch = int((175 - knee_deg) * 0.65)
        lean = int(trunk_deg * 0.7)
        head_x, head_y = 320 + lean, 95 + crouch
        hip_x, hip_y = 320, 195 + crouch
        knee_l_x, knee_l_y = 295 + (14 if idx == 3 else 0), 245 + crouch // 3
        knee_r_x, knee_r_y = 345 - (14 if idx == 3 else 0), 245 + crouch // 3
        d_raw.ellipse([head_x - 18, head_y - 18, head_x + 18, head_y + 18], fill=(60, 70, 85))
        d_raw.line([(head_x, head_y + 18), (hip_x, hip_y)], fill=(60, 70, 85), width=8)
        d_raw.line([(hip_x, hip_y), (knee_l_x, knee_l_y), (285, 295)], fill=(60, 70, 85), width=7)
        d_raw.line([(hip_x, hip_y), (knee_r_x, knee_r_y), (355, 295)], fill=(60, 70, 85), width=7)

        buf = io.BytesIO()
        raw_img.save(buf, format="JPEG", quality=85)
        raw_b64_list.append(base64.b64encode(buf.getvalue()).decode("ascii"))

        # 2. 生成带骨骼线与角度水印的 480x270 子图供 2x2 时序网格使用
        ann = raw_img.resize((480, 270))
        d_ann = ImageDraw.Draw(ann)
        sx, sy = 480 / 640.0, 270 / 360.0
        d_ann.line(
            [(head_x * sx, (head_y + 18) * sy), (hip_x * sx, hip_y * sy)],
            fill=color,
            width=3,
        )
        d_ann.line(
            [(hip_x * sx, hip_y * sy), (knee_l_x * sx, knee_l_y * sy), (285 * sx, 295 * sy)],
            fill=color,
            width=3,
        )
        d_ann.line(
            [(hip_x * sx, hip_y * sy), (knee_r_x * sx, knee_r_y * sy), (355 * sx, 295 * sy)],
            fill=color,
            width=3,
        )
        d_ann.rectangle([8, 8, 330, 34], fill=(24, 24, 28))
        d_ann.text(
            (14, 14),
            f"#{idx} {label} | {ts} | Knee:{knee_deg}deg Trunk:{trunk_deg}deg",
            fill=color,
        )
        annotated_imgs.append(ann)

    grid = Image.new("RGB", (960, 540), (20, 20, 24))
    grid.paste(annotated_imgs[0], (0, 0))
    grid.paste(annotated_imgs[1], (480, 0))
    grid.paste(annotated_imgs[2], (0, 270))
    grid.paste(annotated_imgs[3], (480, 270))

    g_buf = io.BytesIO()
    grid.save(g_buf, format="JPEG", quality=82)
    grid_b64 = base64.b64encode(g_buf.getvalue()).decode("ascii")

    pose_metrics = {
        "window_sec": "00:08.0-00:09.3",
        "fps_sampled": 30,
        "frame_diff_gate": "PASSED (delta=16.8 > threshold=4.0)",
        "keyframes": [
            {"cell": 1, "phase": "START", "time": "00:08.0", "knee_angle_deg": 172, "trunk_lean_deg": 6},
            {"cell": 2, "phase": "LOAD", "time": "00:08.4", "knee_angle_deg": 126, "trunk_lean_deg": 14},
            {
                "cell": 3,
                "phase": "APEX",
                "time": "00:08.8",
                "knee_angle_deg": 84,
                "trunk_lean_deg": 29,
                "knee_valgus_inward_deg": 14,
                "alert": "APEX_KNEE_VALGUS_AND_TRUNK_LEAN",
            },
            {"cell": 4, "phase": "FINISH", "time": "00:09.3", "knee_angle_deg": 168, "trunk_lean_deg": 8},
        ],
    }
    return grid_b64, raw_b64_list, pose_metrics


def main():
    grid_b64, raw_b64_list, pose_metrics = _generate_synthetic_action_frames()
    results = {}
    for model_id in ("gemini-3.8-flash-high", "gemini-3.5-flash-lite"):
        print(f"\n>>> Running HTTP A/B Benchmark on model: {model_id} ...")
        payload = json.dumps(
            {
                "model": model_id,
                "scene_id": "fitness_posture_coach",
                "time_range_label": "00:08.0-00:09.3",
                "grid_image": grid_b64,
                "raw_frames": raw_b64_list,
                "pose_metrics": pose_metrics,
            }
        ).encode("utf-8")
        req = urllib.request.Request(
            "http://localhost:4020/api/coach-lab/benchmark",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=90) as resp:
            res = json.loads(resp.read().decode("utf-8"))
        results[model_id] = res
        comp = res["comparison"]
        print(
            f"[{model_id}]\n"
            f"  Baseline (4裸图): Total={res['baseline']['total_ms']}ms | TTFT={res['baseline']['ttft_ms']}ms | Tokens={res['baseline']['estimated_vision_tokens']}\n"
            f"  Ours (2x2+骨骼) : Total={res['ours']['total_ms']}ms | TTFT={res['ours']['ttft_ms']}ms | Tokens={res['ours']['estimated_vision_tokens']}\n"
            f"  Delta           : Latency Reduction={comp['total_latency_reduction_pct']}% | Token Saved={comp['token_reduction_pct']}%\n"
            f"  Baseline Output : {res['baseline']['text'][:90]}...\n"
            f"  Ours Output     : {res['ours']['text'][:90]}..."
        )

    out_path = os.path.join(os.path.dirname(__file__), "latest_benchmark_result.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print(f"\nSaved full benchmark report to {out_path}")


if __name__ == "__main__":
    main()
