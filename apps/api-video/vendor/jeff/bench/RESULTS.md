# Benchmark results

For the September 19 benchmark-only spam/irony prompt profile and full 1,600-item reruns,
see [task-label prompt results](PROMPT_RESULTS.md). The measurements below retain their original prompts.

All numbers: `knowledgator/gliformer-large-v1`, the 3-question request in
`bench/load.py` (choice + score + noul, 149 tokens) unless noted. GPU tables come
from `modal run deploy/modal_gpu.py` (`bench/results/gpu.jsonl`), HTTP tables
from `bench/load.py` / `deploy/modal_gpu.py::loadtest` (`bench/results/http_modal.jsonl`).
Regenerate the tables with `uv run python bench/summarize.py`. Modal prices are
on-demand list prices (Sep 2026); jev lists $0.042 per 1M input tokens.

## JevBench (bench/jevbench.py, 2026-09-19)

[JevBench](https://github.com/fstandhartinger/jevbench) is Benchmark Heaven's benchmark for
jev-class decision models. jeff is an official entrant since v1.2.2 (commit `e105a48`), run by
the benchmark's author on the full 534-decision set including the held-out items and the judge
tier. Interactive leaderboard: [benchmarkheaven.com/jev-models](https://benchmarkheaven.com/jev-models).

### Official result (JevBench v1.2.2, run by Benchmark Heaven)

Setup as recorded in jevbench's `docs/v1.2-additions.md`: jeff at commit `6f43d3e` with
`knowledgator/gliformer-large-v1` and server defaults, on the author's CPU (4 threads of a
Ryzen 5 3600), through the existing `typesafe` adapter. Latency carries the self-hosted
adjustment (x2 + 0.15 s). Cost is jevbench's estimate for an encoder of this size at hosted
provider prices ($0.01/M input tokens), not a Modal number.

| | jeff | Jev 1.13.0 | #1 classifier.dev (fast) |
|---|---:|---:|---:|
| **JevBench Score (rank of 18)** | **66.9 (#9)** | 75.3 (#2) | 84.8 (#1) |
| Intelligence | 63.9 | 90.4 | 90.1 |
| Calibration | 64.6 | 82.7 | 77.9 |
| Speed | 63.5 | 83.3 | 87.6 |
| Cost | 76.6 | 51.7 | 84.3 |
| easy / standard / judge / hard accuracy | 100 / 76.0 / 61.6 / 37.7% | 100 / 99.0 / 94.5 / 74.1% | 100 / 99.0 / 97.3 / 70.5% |
| hard-tier ECE / Brier | 0.185 / 0.745 | 0.061 / 0.340 | 0.091 / 0.360 |
| $ per 1,000 decisions | $0.0060 est. | $0.0406 | $0.0033 est. |
| p50 raw -> adjusted | 0.94 s -> 2.03 s (CPU) | 0.65 s | 0.39 s |

jeff ranks #9 of 18, one place above the other pure-encoder entrants of similar size
(openJev Verdict 151M at #11, open-jev-deberta-v3-large at #13) and below Laya (421M, #5),
whose lower Intelligence (63.2) is offset by a cheaper cost estimate and faster CPU latency.
jeff's rank is carried by Cost (#5 of 18); Intelligence is #14 and Speed #16, the latter
because the 4-thread CPU run has a 10.97 s p95 on long hard-tier items. Per-subject accuracy
on the official run: everyday language 84.8%, math and numbers 69.0%, coding 67.9%, finance
46.9%, support and operations 47.9%, rules/policy/law 40.3%, safety 50.0%. Hard-tier families
on all 220 items: ambiguous 0/14, long_policy 5/38, multi_hop 17/35, judge_hard 17/33,
temporal_numeric 10/30, trap 11/16, adversarial 7/12.

### Our own runs of the public tiers

The three public tiers (231 decisions: easy 48, standard 72, hard 111) were run one request
at a time from a laptop in North America through jevbench's own `typesafe` adapter, runner and
scoring code, against jeff on the laptop (MPS, fp32), jeff on Modal L4 (`modal serve`, bf16,
flash) and jev's production API on the same day. Per-item records:
`bench/results/jevbench/<run>/<tier>.jsonl`; rerun with
`uv run python bench/jevbench.py run ...` and regenerate the tables with
`uv run python bench/jevbench.py summarize`. Our public-tier accuracies match the official run
(easy 100%, standard 75-76%, hard 38-39% on the public 111 vs 37.7% on all 220), which is the
main reason to keep these runs: they reproduce the official number and add a GPU latency
measurement the official CPU run does not have.

Caveats: the judge tier (146 items) and the held-out halves of the other tiers are not
published, so the Intelligence axis below is renormalised over the public tiers (hard 30,
standard 28, easy 14) and Speed uses the standard tier instead of jevbench's 242-item
standard+judge run. jeff's cost here is the Modal L4 estimate, not a tariff. The score column
is therefore indicative only; the published-systems table shows what the same public items
give for the official entrants.

### JevBench public tiers (jevbench @ e105a48, one request at a time)

| run | endpoint | easy (48) | standard (72) | hard (111) | hard Brier | hard ECE | hard fidelity | std p50 ms | std p95 ms | hard p50 ms | first ms | $/1k decisions |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| jeff-local-mps | cpu | 100.0% | 75.0% | 38.7% | 0.745 | 0.226 | 74.4 | 108 | 137 | 392 | 201 |  |
| jeff-modal-l4 | gpu | 100.0% | 76.4% | 37.8% | 0.745 | 0.217 | 74.3 | 266 | 291 | 273 | 31922 | 0.0173 |
| jev | api | 100.0% | 98.6% | 72.1% | 0.362 | 0.094 | 74.9 | 233 | 359 | 237 | 254 | 0.0384 |

#### Published systems on the same public items (jevbench results/v1.2 per-task artifact)

| system | easy (48) | standard (72) | hard (111) | official hard (220) | official JevBench Score (rank) |
|---|---:|---:|---:|---:|---:|
| classifier.dev (fast tier) | 100.0% | 98.6% | 70.3% | 70.5% | 84.8 (#1) |
| Jev 1.13.0 (TypeSafe AI) | 100.0% | 98.6% | 73.0% | 74.1% | 75.3 (#2) |
| djev (Maisa, diffusion-gemma) | 100.0% | 98.6% | 67.6% | 69.5% | 74.3 (#4) |
| SemIf, formerly OpenJev (Qwen3.5-4B, TheoLeeCJ) | 100.0% | 98.6% | 61.3% | 59.5% | 74.6 (#3) |
| Laya (Convai Innovations, ModernBERT-large 421M) | 95.8% | 69.4% | 35.1% | 34.1% | 70.1 (#5) |
| jeff (Logan Markewich, GLiFormer 400M) | 100.0% | 75.0% | 38.7% | 37.7% | 66.9 (#9) |
| open-jev-deberta-v3-large (local CPU) | 100.0% | 43.1% | 37.8% | 36.4% | 64.4 (#13) |

#### JevBench Score axes (composite_v12; Intelligence without the unpublished judge tier)

| run | Intelligence | Calibration | Speed (adj. p50/p95 ms) | Cost | JevBench Score | Intelligence only |
|---|---:|---:|---:|---:|---:|---:|
| jeff-local-mps | 64.8 | 64.6 | 88.1 (365/425) |  |  |  |
| jeff-modal-l4 | 64.9 | 65.4 | 83.0 (682/731) | 62.9 | 68.6 | 64.9 |
| jev | 87.8 | 78.0 | 90.8 (233/359) | 52.5 | 75.6 | 87.8 |

#### Hard tier by family (correct / n)

| family | jeff-local-mps | jeff-modal-l4 | jev |
|---|---:|---:|---:|
| adversarial | 6/6 | 6/6 | 6/6 |
| ambiguous | 0/7 | 0/7 | 6/7 |
| judge_hard | 8/17 | 8/17 | 12/17 |
| long_policy | 2/19 | 1/19 | 12/19 |
| multi_hop | 7/18 | 7/18 | 15/18 |
| probability | 4/10 | 4/10 | 7/10 |
| routing_hard | 3/5 | 3/5 | 5/5 |
| temporal_numeric | 6/15 | 6/15 | 4/15 |
| tradeoff | 3/6 | 3/6 | 5/6 |
| trap | 4/8 | 4/8 | 8/8 |

- `jeff-local-mps`: http://localhost:8000 (cpu), model `jev-latest`, price None/M in, 0.0/M out.  uv run jeff on an M2 Max (MPS, fp32), defaults; no price (laptop).
- `jeff-modal-l4`: https://llamaindex-research--jeff-gpu-server-web-dev.modal.run (gpu), model `jev-latest`, price 0.03/M in, 0.0/M out. ESTIMATE: $0.030 per 1M input tokens = one L4 container ($0.80/h) at its measured ~50 req/s Modal ingress cap with 149-token requests (bench/RESULTS.md); jeff counts DeBERTa prompt+text tokens, not jev billing tokens. modal serve deploy/modal_gpu.py, client on a laptop in North America.
- `jev`: https://api.typesafe.ai (api), model `jev-latest`, price 0.042/M in, 0.0/M out. public tariff, output not billed. client on a laptop in North America.

Findings:

- **Easy tier is saturated** (48/48) for jeff, as for every published entrant except Needle 3.
- **Standard tier: 76% vs jev 99%.** Extraction and routing are 12/12, policy 11/12, ordinal
  10/12; the misses are adequacy judging (4/12, majority class "yes") and intent (6/12) on the
  L4 run. Paraphrase pairs agree 86% of the time and are both correct 69% (jev 97% / 97%).
- **Hard tier: 38% vs jev 72%** on the public 111. That is the level of
  open-jev-deberta-v3-large (37.8%), the other DeBERTa-class entrant, and below every
  LLM-based rebuild (system-one-open 49%, SemIf 61%, djev 68%). jeff scores 0/7 on ambiguous
  items and 1/19 on long policies (3-4k-token states), 6/6 on adversarial items, and 6/15 on
  temporal/numeric items where jev gets 4/15 (jev's published weakness, 27% on the full 30).
- **Calibration.** Hard-tier ECE 0.22 vs jev 0.09, standard-tier ECE 0.29 vs 0.05. Mean
  top-label confidence on the hard tier is 0.54 (jev 0.79): the temperature-3.2 scaling
  flattens every distribution, so jeff is underconfident on the tiers it gets right (easy:
  100% accuracy at ~0.65 confidence) and its Brier on the standard tier is 0.50 vs 0.03.
  Fidelity to the gold distributions on the 10 probability items matches jev (74 vs 75)
  because the flattened distributions happen to land near the gold ones.
- **Speed.** Short items: 108 ms p50 on the laptop, 266 ms through Modal (jev 233 ms). Hard
  items with 3-4k tokens: 0.5-0.6 s on L4 (jev 0.2-0.3 s) and up to 7 s on fp32 MPS. The
  first L4 request was a 32 s cold start (`modal serve` had scaled to zero); jevbench reports
  it separately and it is not in p50/p95. After jevbench's x2 + 0.15 s adjustment for
  self-hosted endpoints jeff's Speed is 83 vs jev's 91.
- **Cost.** $0.017 per 1,000 decisions at the L4 estimate vs jev's $0.038 (jeff also counts
  fewer tokens on the hard tier: 1,116 vs 1,506 mean, DeBERTa vs jev billing tokens).
- **Score, with the caveats above:** 68.6 for jeff on L4 vs 75.6 for jev on the same items
  (official: 66.9 and 75.3). The L4 run scores higher than the official CPU row because its
  Speed axis is 83 instead of 63.5; Intelligence is the same (65 vs 64). fp32 MPS and bf16 L4
  differ by one item on the standard and one on the hard tier.

## Recommendation (2026-09-18)

**Deploy `deploy/modal_gpu.py` on an L4 for the HTTP API; use A10G only when
requests are long or you run the backend directly.** Reasons, all measured below:

1. **The GPU is not the bottleneck behind Modal's web ingress.** A single
   container serving a *no-model* `POST /healthz` tops out at ~100 req/s and
   p50 rises to 940 ms at 128 clients. With inference in the loop the same
   container caps at ~50 req/s with batches of 2-3, on L4 and A10G alike.
   Scaling out (`target_inputs=16`, now the default) reached 102 req/s with four
   A10G containers, each still running batches of 1-2. Cost therefore scales
   with containers, not with GPU speed, so the cheapest GPU that meets the
   latency target is the right choice.
2. **Latency budget per request, measured from a client inside Modal:** ~165 ms
   Modal ingress round trip (same for `healthz`), ~50 ms Modal ASGI body
   delivery inside the container, 20 ms batch window, 28 ms (A10G) / 45 ms (L4)
   model time. p50 ≈ 270-300 ms intra-Modal, ≈ 440 ms from a laptop in North
   America. The GPU choice moves that by ~17 ms.
3. **Cost.** Idle floor: L4 $0.80/h vs A10G $1.10/h (`min_containers=1`). At
   the ~50 req/s per-container ingress cap and 149-token requests, an L4
   container costs about $0.030 per 1M input tokens and an A10G about $0.041,
   i.e. parity with jev only on L4. If the ingress cap is removed (see below),
   the raw backend does 27k (L4) / 41k (A10G) / 71k (A100) / 120k (H100)
   tokens/s, which is $0.0075-0.0091 per 1M tokens on every GPU, 5-6x under jev.
4. **How to get the GPU's real throughput back:** the cap is Modal's per-container
   web ingress, not jeff (locally, uvicorn on a laptop fills 27-of-32 batches at
   64 clients and the app adds ~3 ms over the batcher). Options, in order:
   (a) call the backend directly from other Modal functions (`Server.score.remote`
   style, no web ingress); (b) more, smaller containers (default now:
   `target_inputs=16`, `max_containers=8`); (c) host uvicorn on a plain GPU VM.

Model-side findings behind the defaults:

- **flashdeberta is faster than eager attention** by 1.5x (149 tok) to 2.7x (894 tok) on L4.
- **torch.compile is slower with the flash kernels.** Inductor cannot rebuild the
  disentangled Triton kernel (fp32/fp64 loop-carried type error); excluding it
  leaves a graph break per layer, dynamo hits `recompile_limit=8` and falls
  back, doubling bs=1 latency (45 -> 100 ms). `eager+compile` is 1.3x faster
  than eager but still well below flash. Defaults: `JEFF_COMPILE=0`,
  `JEFF_PAD_MULTIPLE=0`; the options stay for a newer gliformer/flashdeberta.
- **The bs=1 floor (~28 ms A10G/H100, 45 ms L4) is GPU time, not host work.**
  `torch.profiler` on A10G at bs=1/149 tok: 35.7 ms total, 30.8 ms in the
  model forward, 26.6 ms of CUDA busy time across ~2900 kernels. 54% is
  small-M GEMMs in the 24-layer encoder, 21% is the word-level bidirectional
  LSTM gliformer runs after the encoder (cuDNN RNN, 9.7 ms), flash attention
  itself is 4%. Only ~5 ms is tokenization/collation/decoding. CUDA graphs
  would trim launch gaps (~4 ms), not the floor; a smaller checkpoint would.
- **fp16 vs bf16 (A10G):** no latency gain (bs=1 33.7 vs 27.8 ms, peak 43k vs
  41k tok/s, within run-to-run noise) and raw scores drift up to 0.029 (mean
  0.003) over 40 labels. Keep bf16.
- **A100-40GB** is 1.7x A10G throughput at 1.9x the price and has *worse* bs=1
  latency in our runs (49 ms); no reason to pick it over A10G or H100.
- **Batch window.** `JEFF_MAX_WAIT_MS` 5 -> 20 did not change batch sizes on
  Modal (ingress-limited); locally 20 ms fills batches. Default is 10.

## Noul context sensitivity (bench/noul_probe.py, 2026-09-18)

Setup: 12 short support messages x 2 yes/no questions each with unambiguous
answers (24 nouls), each asked in 4 contexts (alone; before a choice; before a
choice + score; after both) and with `state` as a string or as
`{subject, message}`. Variants: noul rendering (`single` = the question is the
one label; `single_named` = question as group name, label "yes"; `yes_no` =
two labels under the question, renormalized), isolation (`none` = all
questions in one prompt; `nouls` = each noul in its own encoder pass) and
object-state format (`kv`, `json`, `values`). `spread` = mean over nouls of
(max - min) of the answer across the 4 contexts; `worst` = the largest such
range. Raw rows: `bench/results/noul_probe.jsonl`.

**gliformer-large-v1**, string state (dict state in parentheses):

| variant | acc | mae | spread | worst | alone | first | first2 | last |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| single / none / kv | 0.66 (0.67) | 0.33 | 0.32 | 0.98 | 0.83 | 0.71 | 0.58 | 0.50 |
| single_named / none / kv | 0.67 (0.73) | 0.34 | 0.57 | 0.98 | 0.75 | 0.71 | 0.75 | 0.46 |
| yes_no / none / kv | 0.83 (0.81) | 0.19 | 0.28 | 0.87 | 0.79 | 0.83 | 1.00 | 0.71 |
| single / nouls / kv | 0.83 (0.79) | 0.19 | 0 | 0 | 0.83 | = | = | = |
| single_named / nouls / kv | 0.75 (0.83) | 0.27 | 0 | 0 | 0.75 | = | = | = |
| **yes_no / nouls / kv** (default) | 0.79 (0.83) | 0.19 (0.17) | 0 | 0 | 0.79 | = | = | = |

Findings:

- **Sharing one prompt is the cause.** Every group's labels are tokens in the
  same DeBERTa sequence as the text, so the other questions change a noul's
  label representation. With a noul last after a choice and a score, `single`
  is at chance (0.50) and individual answers move by up to 0.98 (e.g. "Does
  the customer request a refund?" on a clear refund request: 1.00 alone, 0.02
  last). Choice/score groups are covered by the multi-question eval below.
- **Isolation removes the effect** (spread 0) and costs one extra
  batched encoder pass per noul (the text is re-encoded per isolated
  question, so `usage.input_tokens` grows accordingly). `JEFF_ISOLATE=all`
  extends the same guarantee to choice/score questions.
- **Rendering makes no measurable difference once isolated** (0.75-0.83 on
  24 items is within noise). `yes_no` has the lowest error and returns graded probabilities;
  `single` saturates at 0.00/1.00 and flips on state format (0.99 vs 0.01 for
  the same noul with string vs dict state). Remaining misses under `yes_no`
  are borderline items: a "where is my refund" complaint scored as not a
  refund request, a login failure scored as not a bug, and "reporting a bug"
  false positives on a double-charge email.
- **State format**: `kv` (`subject: ...\nmessage: ...`) is as good as string
  state; `json` and `values` are not better. The 0.02 seen in the original
  bug report was the shared-prompt effect, not the rendering.
- **gliformer-base-v1 cannot answer nouls** in any variant (best 0.67 with
  `single`, `yes_no` is 0.38). Keep base for tests only; if you must serve it,
  set `JEFF_NOUL_MODE=single`.

## CPU arm (bench/cpu_bench.py, deploy/modal_cpu.py, 2026-09-18)

Setup: the DeBERTa encoder exported to ONNX (`scripts/export_onnx.py`), run in
ONNX Runtime with `ORT_ENABLE_ALL`, threads = cores; word RNN + classification
head in torch fp32. `torch-fp32` is the all-torch eager CPU path for
comparison, `torch-mps` the Mac GPU. Modal rows are 8-core containers with
8 GiB ($1.73/h at list price). Tables below; rows in `bench/results/cpu.jsonl`.

**Verdict: the CPU arm is not a cheaper tier for `gliformer-large-v1`.** It is
the fallback for hosts with no GPU at all (scale-to-zero CPU containers, no GPU
quota, laptops without MPS).

| host | model | config | bs=1 @152 tok | peak tokens/s | $/M tokens | vs jev ($0.042) |
|---|---|---|---:|---:|---:|---:|
| Modal 8-core | large | onnx-int8 | 296 ms | 675 | 0.71 | 17x more expensive |
| Modal 8-core | large | onnx-fp32 | 368 ms | 582 | 0.83 | 20x |
| Modal 8-core | large | torch-fp32 | 608 ms | 584 | 0.82 | 20x |
| Modal 8-core | base | onnx-int8 | 137 ms | 1770 | 0.27 | 6x (and int8 is broken here, see below) |
| Modal 8-core | base | onnx-fp32 | 161 ms | 1533 | 0.31 | 7x |
| M2 Max (12 threads) | large | onnx-int8 | 160 ms | 1030 | - | - |
| M2 Max | large | onnx-fp32 | 230 ms | 706 | - | - |
| M2 Max | large | torch-fp32 | 206 ms | 1699 | - | - |
| M2 Max | large | torch-mps | 94 ms | 5169 | - | - |
| Modal L4 (GPU arm, for scale) | large | flash bf16 | 45 ms | 27000 | 0.0081 | 5x cheaper |

Findings:

- **Throughput per dollar is 40-90x worse than an L4** and 6-20x worse than
  jev's list price. A 24-layer, 1024-wide encoder needs ~150 GFLOP per
  150-token request; 8 x86 cores deliver ~0.6k tokens/s however the graph is
  run. Batching helps little on CPU (ms/text falls ~20% from bs=1 to bs=16), so
  CPU is not cheaper at any batch size.
- **ONNX vs torch on CPU:** ORT is 1.6-2x faster than eager torch at bs=1 on
  x86 (368 vs 608 ms) but equal at bs=16; on Apple silicon torch's Accelerate
  BLAS is faster than ORT's MLAS at any batch > 1 (89 vs 215 ms/text at bs=16)
  and MPS is 2-3x faster than both. On a Mac, use `JEFF_DEVICE=mps`, not the ONNX arm.
- **int8 dynamic quantization needs two fixes to be usable.** (1) The FFN
  output projection (post-GELU input, DeBERTa's activation outliers) must stay
  fp32: quantizing it moves raw scores by 0.28-0.33 on average (max 0.97),
  whether per-tensor, per-channel, uint8 or reduced range; skipping those 24
  MatMuls leaves mean drift 0.02 on ARM. (2) On x86 ORT's u8s8 kernels overflow
  without `reduce_range` (7-bit weights): the ARM-clean file drifted 0.22 mean
  on Modal; with `reduce_range` it is 0.04 mean / 0.40 max. Both are the
  exporter defaults now (`onnx_export.FP32_NODE_PATTERNS`, `reduce_range=True`).
  What int8 gives after that: 1.25x at bs=1 on x86, 1.4x on ARM, 40% smaller
  file (1.0 vs 1.7 GB; the 128k x 1024 embedding table stays fp32).
- **base + int8 on x86 is still broken** (drift 0.83 mean, identical to four
  decimals across two different quantized files, i.e. the outputs saturate to a
  constant); the same file is fine on ARM (0.06 mean) and base fp32 ONNX is
  fine on x86. Not investigated further because base cannot answer nouls
  anyway (see the noul probe). If a cheap tier matters, the next things to try
  are static (calibrated) quantization or a distilled checkpoint, not more
  dynamic-quant settings.
- Max int8 drift of 0.2-0.4 on a single raw score is larger than fp16's 0.03
  on GPU; use `JEFF_QUANT=fp32` where accuracy matters more than 25% latency.

## GPU-arm profile, A10G, bs=1, 149 tokens

| stage | ms |
|---|---:|
| total `score()` | 35.7 |
| model forward | 30.8 |
| outside forward (tokenize, collate, decode) | 4.9 |
| CUDA busy inside forward | 26.6 |
| CUDA kernels per call | 2918 |

| CUDA time share | |
|---|---:|
| `aten::addmm` (encoder linears) | 54% |
| cuDNN LSTM (`_apply_word_rnn`) | 21% |
| flash disentangled attention | 4% |
| `bmm`, layer norm, copies | ~15% |

## Raw backend latency (no HTTP), gliformer-large-v1, bf16

Median of 10 calls after a warm call. `seq` = prompt+text tokens per request (3 questions).

### NVIDIA A10 — flash

| seq | batch | ms/batch | ms/text | texts/s | tokens/s |
|---:|---:|---:|---:|---:|---:|
| 149 | 1 | 27.8 | 27.77 | 36.0 | 5366 |
| 149 | 4 | 31.2 | 7.81 | 128.1 | 19084 |
| 149 | 16 | 95.7 | 5.98 | 167.2 | 24910 |
| 149 | 32 | 179.3 | 5.6 | 178.4 | 26585 |
| 469 | 1 | 34.9 | 34.88 | 28.7 | 13448 |
| 469 | 4 | 61.4 | 15.35 | 65.1 | 30546 |
| 469 | 16 | 188.0 | 11.75 | 85.1 | 39919 |
| 469 | 32 | 366.2 | 11.44 | 87.4 | 40980 |
| 894 | 1 | 49.6 | 49.58 | 20.2 | 18032 |
| 894 | 4 | 119.4 | 29.85 | 33.5 | 29950 |
| 894 | 16 | 367.0 | 22.93 | 43.6 | 38981 |
| 894 | 32 | 707.8 | 22.12 | 45.2 | 40416 |

### NVIDIA A100-SXM4-40GB — flash

| seq | batch | ms/batch | ms/text | texts/s | tokens/s |
|---:|---:|---:|---:|---:|---:|
| 149 | 1 | 48.8 | 48.77 | 20.5 | 3055 |
| 149 | 4 | 55.3 | 13.82 | 72.4 | 10785 |
| 149 | 16 | 68.0 | 4.25 | 235.4 | 35081 |
| 149 | 32 | 92.0 | 2.88 | 347.8 | 51817 |
| 469 | 1 | 62.3 | 62.35 | 16.0 | 7523 |
| 469 | 4 | 70.4 | 17.61 | 56.8 | 26639 |
| 469 | 16 | 127.3 | 7.96 | 125.7 | 58946 |
| 469 | 32 | 211.6 | 6.61 | 151.2 | 70931 |
| 894 | 1 | 68.5 | 68.54 | 14.6 | 13044 |
| 894 | 4 | 102.4 | 25.6 | 39.1 | 34916 |
| 894 | 16 | 239.8 | 14.99 | 66.7 | 59647 |
| 894 | 32 | 419.7 | 13.12 | 76.2 | 68156 |

### NVIDIA A10G — flash-fp16

| seq | batch | ms/batch | ms/text | texts/s | tokens/s |
|---:|---:|---:|---:|---:|---:|
| 149 | 1 | 33.7 | 33.67 | 29.7 | 4425 |
| 149 | 4 | 39.1 | 9.77 | 102.4 | 15254 |
| 149 | 16 | 74.0 | 4.62 | 216.3 | 32222 |
| 149 | 32 | 133.4 | 4.17 | 239.9 | 35743 |
| 469 | 1 | 42.6 | 42.61 | 23.5 | 11007 |
| 469 | 4 | 65.2 | 16.31 | 61.3 | 28756 |
| 469 | 16 | 187.9 | 11.74 | 85.1 | 39935 |
| 469 | 32 | 347.6 | 10.86 | 92.1 | 43177 |
| 894 | 1 | 53.8 | 53.76 | 18.6 | 16631 |
| 894 | 4 | 118.4 | 29.6 | 33.8 | 30198 |
| 894 | 16 | 362.5 | 22.66 | 44.1 | 39460 |
| 894 | 32 | 696.0 | 21.75 | 46.0 | 41104 |

### NVIDIA H100 80GB HBM3 — flash

| seq | batch | ms/batch | ms/text | texts/s | tokens/s |
|---:|---:|---:|---:|---:|---:|
| 149 | 1 | 28.2 | 28.23 | 35.4 | 5278 |
| 149 | 4 | 33.0 | 8.26 | 121.0 | 18034 |
| 149 | 16 | 40.5 | 2.53 | 394.8 | 58819 |
| 149 | 32 | 63.1 | 1.97 | 507.1 | 75557 |
| 469 | 1 | 39.4 | 39.42 | 25.4 | 11899 |
| 469 | 4 | 46.5 | 11.63 | 86.0 | 40316 |
| 469 | 16 | 78.2 | 4.88 | 204.7 | 96013 |
| 469 | 32 | 126.8 | 3.96 | 252.4 | 118373 |
| 894 | 1 | 47.1 | 47.05 | 21.3 | 19000 |
| 894 | 4 | 59.7 | 14.93 | 67.0 | 59872 |
| 894 | 16 | 138.5 | 8.65 | 115.5 | 103299 |
| 894 | 32 | 238.4 | 7.45 | 134.2 | 120009 |

### NVIDIA L4 — eager

| seq | batch | ms/batch | ms/text | texts/s | tokens/s |
|---:|---:|---:|---:|---:|---:|
| 149 | 1 | 67.1 | 67.09 | 14.9 | 2221 |
| 149 | 4 | 70.9 | 17.73 | 56.4 | 8405 |
| 149 | 16 | 190.3 | 11.9 | 84.1 | 12524 |
| 149 | 32 | 389.8 | 12.18 | 82.1 | 12231 |
| 469 | 1 | 72.1 | 72.11 | 13.9 | 6504 |
| 469 | 4 | 154.4 | 38.61 | 25.9 | 12148 |
| 469 | 16 | 572.6 | 35.79 | 27.9 | 13106 |
| 469 | 32 | 1136.1 | 35.5 | 28.2 | 13210 |
| 894 | 1 | 115.4 | 115.38 | 8.7 | 7748 |
| 894 | 4 | 391.0 | 97.75 | 10.2 | 9146 |
| 894 | 16 | 1454.8 | 90.92 | 11.0 | 9832 |
| 894 | 32 | 2898.1 | 90.56 | 11.0 | 9871 |

### NVIDIA L4 — eager+compile

| seq | batch | ms/batch | ms/text | texts/s | tokens/s |
|---:|---:|---:|---:|---:|---:|
| 149 | 1 | 26.6 | 26.58 | 37.6 | 5605 |
| 149 | 4 | 53.5 | 13.37 | 74.8 | 11143 |
| 149 | 16 | 167.4 | 10.46 | 95.6 | 14239 |
| 149 | 32 | 340.2 | 10.63 | 94.1 | 14016 |
| 469 | 1 | 45.4 | 45.45 | 22.0 | 10320 |
| 469 | 4 | 111.2 | 27.81 | 36.0 | 16865 |
| 469 | 16 | 393.3 | 24.58 | 40.7 | 19080 |
| 469 | 32 | 779.3 | 24.35 | 41.1 | 19258 |
| 894 | 1 | 71.1 | 71.09 | 14.1 | 12575 |
| 894 | 4 | 209.7 | 52.42 | 19.1 | 17054 |
| 894 | 16 | 794.6 | 49.66 | 20.1 | 18002 |
| 894 | 32 | 1642.8 | 51.34 | 19.5 | 17414 |

### NVIDIA L4 — flash

| seq | batch | ms/batch | ms/text | texts/s | tokens/s |
|---:|---:|---:|---:|---:|---:|
| 149 | 1 | 44.8 | 44.81 | 22.3 | 3325 |
| 149 | 4 | 58.3 | 14.57 | 68.6 | 10226 |
| 149 | 16 | 132.6 | 8.29 | 120.7 | 17984 |
| 149 | 32 | 269.1 | 8.41 | 118.9 | 17718 |
| 469 | 1 | 48.7 | 48.68 | 20.5 | 9635 |
| 469 | 4 | 99.2 | 24.8 | 40.3 | 18913 |
| 469 | 16 | 279.2 | 17.45 | 57.3 | 26878 |
| 469 | 32 | 546.1 | 17.07 | 58.6 | 27482 |
| 894 | 1 | 53.2 | 53.19 | 18.8 | 16807 |
| 894 | 4 | 152.7 | 38.18 | 26.2 | 23418 |
| 894 | 16 | 572.9 | 35.81 | 27.9 | 24966 |
| 894 | 32 | 1090.6 | 34.08 | 29.3 | 26231 |

### NVIDIA L4 — flash+compile+debug

| seq | batch | ms/batch | ms/text | texts/s | tokens/s |
|---:|---:|---:|---:|---:|---:|
| 149 | 1 | 107.9 | 107.95 | 9.3 | 1380 |
| 149 | 4 | 109.4 | 27.36 | 36.5 | 5446 |
| 149 | 16 | 125.0 | 7.81 | 128.0 | 19075 |
| 149 | 32 | 213.5 | 6.67 | 149.9 | 22331 |
| 469 | 1 | 103.8 | 103.79 | 9.6 | 4519 |
| 469 | 4 | 117.3 | 29.33 | 34.1 | 15989 |
| 469 | 16 | 246.8 | 15.43 | 64.8 | 30403 |
| 469 | 32 | 487.9 | 15.25 | 65.6 | 30759 |
| 894 | 1 | 97.6 | 97.56 | 10.3 | 9164 |
| 894 | 4 | 139.9 | 34.99 | 28.6 | 25552 |
| 894 | 16 | 498.9 | 31.18 | 32.1 | 28670 |
| 894 | 32 | 996.2 | 31.13 | 32.1 | 28718 |

## Cost at peak throughput (flash, best batch)

jev list price: $0.042/M input tokens.

| GPU | $/h | peak tokens/s | $/M tokens | vs jev | bs=1 latency @149 tok |
|---|---:|---:|---:|---:|---:|
| NVIDIA A10 | 1.10 | 40980 | 0.0075 | 6x cheaper | 27.8 ms |
| NVIDIA A100-SXM4-40GB | 2.10 | 70931 | 0.0082 | 5x cheaper | 48.8 ms |
| NVIDIA H100 80GB HBM3 | 3.95 | 120009 | 0.0091 | 5x cheaper | 28.2 ms |
| NVIDIA L4 | 0.80 | 27482 | 0.0081 | 5x cheaper | 44.8 ms |
## HTTP load tests (bench/load.py)

### A10G serve, client in Modal, wait 20ms

| concurrency | req/s | p50 ms | p95 ms | p99 ms | errors |
|---:|---:|---:|---:|---:|---|
| 1 | 3.0 | 333.3 | 342.8 | 355.0 |  |
| 8 | 20.2 | 364.4 | 550.9 | 651.1 |  |
| 32 | 43.0 | 690.2 | 944.6 | 1010.2 |  |
| 64 | 45.1 | 1352.1 | 1821.3 | 2169.7 |  |
| 128 | 50.4 | 2159.0 | 3127.2 | 3437.9 |  |

### A10G deploy, client in Modal, wait 20ms

| concurrency | req/s | p50 ms | p95 ms | p99 ms | errors |
|---:|---:|---:|---:|---:|---|
| 1 | 3.4 | 291.7 | 312.9 | 409.3 |  |
| 8 | 15.9 | 485.4 | 680.1 | 785.8 |  |
| 32 | 35.0 | 855.5 | 1331.8 | 1477.3 |  |
| 64 | 47.1 | 1164.9 | 1828.0 | 2067.4 |  |
| 128 | 52.1 | 2151.7 | 2779.0 | 2866.9 |  |

### A10G deploy, POST /healthz (no model)

| concurrency | req/s | p50 ms | p95 ms | p99 ms | errors |
|---:|---:|---:|---:|---:|---|
| 8 | 24.2 | 283.0 | 417.3 | 433.0 | {'405': 10} |
| 32 | 63.8 | 446.4 | 902.5 | 1002.5 |  |
| 64 | 91.7 | 542.3 | 1430.8 | 1604.1 |  |
| 128 | 99.5 | 937.3 | 1809.5 | 1875.1 |  |

### A10G deploy target_inputs=16, 64 clients x 1500 req

| concurrency | req/s | p50 ms | p95 ms | p99 ms | errors |
|---:|---:|---:|---:|---:|---|
| 64 | 102.2 | 560.3 | 1133.4 | 1781.0 |  |
| 64 | 71.4 | 628.3 | 2448.9 | 3675.0 |  |
| 64 | 69.7 | 581.7 | 2560.6 | 3942.7 |  |

### A10G serve, client on Mac, wait 20ms

| concurrency | req/s | p50 ms | p95 ms | p99 ms | errors |
|---:|---:|---:|---:|---:|---|
| 1 | 2.4 | 410.9 | 455.1 | 796.8 |  |
| 8 | 14.1 | 552.2 | 730.4 | 807.8 |  |
| 32 | 35.0 | 871.9 | 1124.3 | 1454.7 |  |
| 64 | 43.1 | 1297.9 | 2169.0 | 2297.1 |  |
| 128 | 50.2 | 2170.7 | 2964.2 | 3045.2 |  |

### L4 serve, client on Mac, wait 5ms

| concurrency | req/s | p50 ms | p95 ms | p99 ms | errors |
|---:|---:|---:|---:|---:|---|
| 1 | 4.5 | 217.9 | 232.2 | 269.2 |  |
| 8 | 20.7 | 379.5 | 521.4 | 667.7 |  |
| 32 | 28.8 | 1033.8 | 1822.4 | 1833.6 |  |
| 64 | 38.5 | 1552.9 | 2223.0 | 2242.7 |  |

## CPU arm: raw backend latency (bench/cpu_bench.py)

Median of 5 calls after a warm call, same 3-question request. `torch-fp32` is eager PyTorch on CPU; `onnx-*` runs the DeBERTa encoder in ONNX Runtime (rest in torch).

### gliformer-base-v1 — modal-cpu-8 — onnx-fp32 (8 threads)

| seq | batch | ms/batch | ms/text | texts/s | tokens/s |
|---:|---:|---:|---:|---:|---:|
| 152 | 1 | 160.6 | 160.6 | 6.2 | 946 |
| 152 | 4 | 501.4 | 125.36 | 8.0 | 1212 |
| 152 | 16 | 1586.8 | 99.17 | 10.1 | 1533 |
| 472 | 1 | 543.3 | 543.27 | 1.8 | 869 |
| 472 | 4 | 1821.2 | 455.31 | 2.2 | 1037 |
| 472 | 16 | 5824.8 | 364.05 | 2.7 | 1297 |

### gliformer-base-v1 — modal-cpu-8 — onnx-int8 (8 threads)

| seq | batch | ms/batch | ms/text | texts/s | tokens/s |
|---:|---:|---:|---:|---:|---:|
| 152 | 1 | 136.9 | 136.89 | 7.3 | 1110 |
| 152 | 4 | 434.1 | 108.53 | 9.2 | 1401 |
| 152 | 16 | 1373.9 | 85.87 | 11.6 | 1770 |
| 472 | 1 | 519.7 | 519.75 | 1.9 | 908 |
| 472 | 4 | 1639.1 | 409.77 | 2.4 | 1152 |
| 472 | 16 | 5190.9 | 324.43 | 3.1 | 1455 |

### gliformer-base-v1 — modal-cpu-8 — torch-fp32 (8 threads)

| seq | batch | ms/batch | ms/text | texts/s | tokens/s |
|---:|---:|---:|---:|---:|---:|
| 152 | 1 | 231.1 | 231.08 | 4.3 | 658 |
| 152 | 4 | 541.2 | 135.31 | 7.4 | 1123 |
| 152 | 16 | 1676.6 | 104.79 | 9.5 | 1451 |
| 472 | 1 | 578.8 | 578.85 | 1.7 | 815 |
| 472 | 4 | 1725.3 | 431.34 | 2.3 | 1094 |
| 472 | 16 | 5121.3 | 320.08 | 3.1 | 1475 |

### gliformer-large-v1 — local-darwin-arm64-12cpu (M2 Max) — onnx-fp32 (12 threads)

| seq | batch | ms/batch | ms/text | texts/s | tokens/s |
|---:|---:|---:|---:|---:|---:|
| 152 | 1 | 232.6 | 232.58 | 4.3 | 654 |
| 152 | 4 | 891.3 | 222.83 | 4.5 | 682 |
| 152 | 16 | 3471.4 | 216.96 | 4.6 | 701 |
| 472 | 1 | 807.0 | 807.0 | 1.2 | 585 |
| 472 | 4 | 3132.0 | 783.01 | 1.3 | 603 |
| 472 | 16 | 12028.6 | 751.79 | 1.3 | 628 |

### gliformer-large-v1 — local-darwin-arm64-12cpu (M2 Max) — onnx-int8 (12 threads)

| seq | batch | ms/batch | ms/text | texts/s | tokens/s |
|---:|---:|---:|---:|---:|---:|
| 152 | 1 | 160.1 | 160.06 | 6.2 | 950 |
| 152 | 4 | 619.2 | 154.8 | 6.5 | 982 |
| 152 | 16 | 2368.3 | 148.02 | 6.8 | 1027 |
| 472 | 1 | 596.4 | 596.39 | 1.7 | 791 |
| 472 | 4 | 2279.4 | 569.84 | 1.8 | 828 |
| 472 | 16 | 8677.0 | 542.31 | 1.8 | 870 |

### gliformer-large-v1 — local-darwin-arm64-12cpu (M2 Max) — torch-fp32 (12 threads)

| seq | batch | ms/batch | ms/text | texts/s | tokens/s |
|---:|---:|---:|---:|---:|---:|
| 152 | 1 | 205.7 | 205.74 | 4.9 | 739 |
| 152 | 4 | 452.9 | 113.24 | 8.8 | 1342 |
| 152 | 16 | 1431.6 | 89.48 | 11.2 | 1699 |
| 472 | 1 | 462.6 | 462.59 | 2.2 | 1020 |
| 472 | 4 | 1651.1 | 412.77 | 2.4 | 1144 |
| 472 | 16 | 4887.1 | 305.44 | 3.3 | 1545 |

### gliformer-large-v1 — local-darwin-arm64-12cpu (M2 Max) — torch-mps (12 threads)

| seq | batch | ms/batch | ms/text | texts/s | tokens/s |
|---:|---:|---:|---:|---:|---:|
| 152 | 1 | 93.7 | 93.75 | 10.7 | 1621 |
| 152 | 4 | 170.1 | 42.53 | 23.5 | 3574 |
| 152 | 16 | 470.5 | 29.41 | 34.0 | 5169 |
| 472 | 1 | 297.8 | 297.84 | 3.4 | 1585 |
| 472 | 4 | 822.0 | 205.51 | 4.9 | 2297 |
| 472 | 16 | 2819.6 | 176.22 | 5.7 | 2678 |

### gliformer-large-v1 — modal-cpu-8 — onnx-fp32 (8 threads)

| seq | batch | ms/batch | ms/text | texts/s | tokens/s |
|---:|---:|---:|---:|---:|---:|
| 152 | 1 | 367.6 | 367.64 | 2.7 | 413 |
| 152 | 4 | 1215.6 | 303.9 | 3.3 | 500 |
| 152 | 16 | 4180.8 | 261.3 | 3.8 | 582 |
| 472 | 1 | 1301.0 | 1301.02 | 0.8 | 363 |
| 472 | 4 | 4497.3 | 1124.33 | 0.9 | 420 |
| 472 | 16 | 16720.5 | 1045.03 | 1.0 | 452 |

### gliformer-large-v1 — modal-cpu-8 — onnx-int8 (8 threads)

| seq | batch | ms/batch | ms/text | texts/s | tokens/s |
|---:|---:|---:|---:|---:|---:|
| 152 | 1 | 296.4 | 296.38 | 3.4 | 513 |
| 152 | 4 | 1101.5 | 275.39 | 3.6 | 552 |
| 152 | 16 | 3605.0 | 225.31 | 4.4 | 675 |
| 472 | 1 | 1282.7 | 1282.69 | 0.8 | 368 |
| 472 | 4 | 4302.3 | 1075.57 | 0.9 | 439 |
| 472 | 16 | 13101.9 | 818.87 | 1.2 | 576 |

### gliformer-large-v1 — modal-cpu-8 — torch-fp32 (8 threads)

| seq | batch | ms/batch | ms/text | texts/s | tokens/s |
|---:|---:|---:|---:|---:|---:|
| 152 | 1 | 608.2 | 608.21 | 1.6 | 250 |
| 152 | 4 | 1398.9 | 349.72 | 2.9 | 435 |
| 152 | 16 | 4162.6 | 260.17 | 3.8 | 584 |
| 472 | 1 | 1406.7 | 1406.69 | 0.7 | 336 |
| 472 | 4 | 3891.8 | 972.96 | 1.0 | 485 |
| 472 | 16 | 13705.0 | 856.57 | 1.2 | 551 |

### int8 vs fp32 raw score drift

| model | host | max abs | mean abs | n scores |
|---|---|---:|---:|---:|
| gliformer-large-v1 | modal-cpu-8 | 0.3951 | 0.0398 | 32 |
| gliformer-large-v1 | local-darwin-arm64-12cpu (M2 Max) | 0.1863 | 0.0285 | 32 |
| gliformer-base-v1 | modal-cpu-8 | 0.9998 | 0.8301 | 32 |

### Cost at peak throughput on Modal CPU containers

| model | container | config | peak tokens/s | $/h | $/M tokens | vs jev | bs=1 latency @149 tok |
|---|---|---|---:|---:|---:|---:|---:|
| gliformer-base-v1 | modal-cpu-8 | onnx-fp32 | 1533 | 1.73 | 0.3131 | 7x more expensive | 160.6 ms |
| gliformer-base-v1 | modal-cpu-8 | onnx-int8 | 1770 | 1.73 | 0.2712 | 6x more expensive | 136.9 ms |
| gliformer-base-v1 | modal-cpu-8 | torch-fp32 | 1475 | 1.73 | 0.3254 | 8x more expensive | 231.1 ms |
| gliformer-large-v1 | modal-cpu-8 | onnx-fp32 | 582 | 1.73 | 0.8247 | 20x more expensive | 367.6 ms |
| gliformer-large-v1 | modal-cpu-8 | onnx-int8 | 675 | 1.73 | 0.7111 | 17x more expensive | 296.4 ms |
| gliformer-large-v1 | modal-cpu-8 | torch-fp32 | 584 | 1.73 | 0.8219 | 20x more expensive | 608.2 ms |


## Accuracy, calibration and latency vs jev (bench/eval_accuracy.py, 2026-09-18)

Eval set: `bench/build_evalset.py` samples 200 label-balanced items from each of eight public
datasets into `bench/data/*.jsonl`, one jev question per item, written the way a jev user would
write it (instruction + criteria with short descriptions): **choice** AG News (4 topics),
dair-ai/emotion (6 emotions); **score** SST-5 (5 sentiment levels), Amazon reviews (1-5 stars,
object `state`); **noul** SMS spam, SST-2 (is it positive?), TweetEval irony, BoolQ (passage as
`state`, the question as `instructions`). 1,600 items total. Runs: `large/<variant>` =
gliformer-large-v1 in-process on an M2 Max (variants are `PromptOptions` changes, `default` is
what the server ships), `jeff-l4-http` = the same model behind `deploy/modal_gpu.py` on an L4,
`jev/*` = api.typesafe.ai. Raw rows: `bench/results/accuracy.jsonl`; regenerate the tables with
`uv run python bench/eval_accuracy.py summarize --full`.

Runs suffixed `+multi` send the labeled question *last* in a request with three unrelated
questions (a 4-way team choice, a 3-level urgency score, a "does it ask a question?" noul);
`noiso`/`isoall` are `JEFF_ISOLATE=none|all`. `large/default` and `large+multi/*` rows use the
shipped `JEFF_TEMPERATURE=3.2`; `large-t1/default` is the same configuration at T=1 and the
other `large/*` variants and `jeff-l4-http` were also run at T=1 (temperature only affects the `ece`, `pmax`,
`brier` and `mean_p` columns; every accuracy metric is temperature-invariant).

Metrics: `acc`/`f1` (macro) for choice; `mae` of the expected score vs the ordinal label
(`mae_mid` = always answering the middle level), `acc_argmax`, Spearman for score; AUROC,
accuracy at 0.5 and Brier for nouls; `ece` = expected calibration error of the top
probability (10 bins); `pmax`/`mean_p` = mean top probability / mean noul.

**Findings**

1. **jev is more accurate on every task except binary sentiment.** Averaged over tasks: choice
   acc 0.69 vs 0.61, score MAE 0.48 vs 0.61, noul AUROC 0.975 vs 0.84. The gap is small on
   SST-2 (0.996 vs 0.991 AUROC) and SMS spam (0.99 vs 0.92), and large wherever the answer
   needs inference rather than lexical cues: BoolQ 0.95 vs 0.75, irony 0.96 vs 0.71, AG News
   90% vs 76%. Both are ~47% on 6-way emotion and agree with each other only 61% of the time
   there, so that dataset's labels are the limit, not the models. jev-preview equals jev-latest
   within noise.
2. **Prompt variants: the shipped defaults are the best measured.** Folding descriptions into labels
   (`default`) vs bare keys (`nodesc`): +2.5 pt on AG News but irony AUROC collapses 0.71 ->
   0.49 and spam/BoolQ do not improve, so folding stays on. Group name = instruction (`default`) vs
   question id (`idname`): nouls fall to chance (0.84 -> 0.61 AUROC); the instruction must be
   the group name. `single` noul mode is worse than `yes_no` (0.80 vs 0.84 AUROC, and SST-2 drops to
   0.86). `json` state rendering = `kv` within noise.
3. **jeff is over-confident; one global temperature fixes most of it.** At T = 1 the ECE on
   choice/score was 0.17-0.41 vs jev's 0.06-0.38. `bench/calibrate.py` fits T ≈ 3.2 on
   `probabilities**(1/T)` (identical to temperature-scaling the sigmoids) with leave-one-task-out
   values of 3.1-3.3 for every task and kind, i.e. it generalizes. At T = 3.2 ECE halves
   (emotion 0.36 -> 0.04, Amazon 0.41 -> 0.12, BoolQ 0.25 -> 0.08) and noul Brier improves on
   the hard tasks (BoolQ 0.27 -> 0.21, irony 0.29 -> 0.22). Tempering the distribution the
   expected `score` is taken from pulls it toward the middle level (+0.05 to +0.09 MAE), so the
   decoder tempers `probabilities`/`confidence`/`noul` only and computes `score` from the raw
   distribution. **Shipped as `JEFF_TEMPERATURE=3.2` (default).** The `large/default` rows below
   are at 3.2 and every accuracy number is identical to the T = 1 run. jev's own nouls fit
   T = 0.75 (slightly *under*-confident), its choices T = 4.6 (driven by emotion).
4. **Multi-question requests.** With three unrelated questions ahead of the labeled one
   (`+multi`): jev is unchanged on every metric (it evidently scores questions independently).
   jeff with the default `isolate=nouls`: nouls identical to single-question (isolation works),
   choice -1.5 pt (AG News 0.755 -> 0.740, emotion 0.470 -> 0.450) and score +0.01-0.03 MAE
   (Amazon 0.600 -> 0.630) because those share one prompt with the distractors. `isolate=none`
   additionally moves the nouls (BoolQ 0.750 -> 0.731 AUROC, irony 0.714 -> 0.758, spam 0.918 ->
   0.900) and roughly doubles their ECE (spam 0.11 -> 0.23), confirming the probe. `isolate=all`
   reproduces the single-question numbers exactly for ~50% more tokens than the default
   (344 vs 231 on AG News) and ~20% more time. Default stays `nouls`; set `JEFF_ISOLATE=all`
   when choice/score answers must not depend on the rest of the request.
5. **Latency from a laptop:** sequential p50 jev 129 ms vs jeff-on-L4 151 ms; at 8 concurrent
   clients jev stays at 131 ms while jeff-L4 rises to 267 ms (p95 588) because one Modal container's
   web ingress serializes requests (see the GPU section). In-process on the M2 Max the model itself is
   12-70 ms per item at batch 16.
6. **Tokens and cost per request.** jev bills 372 input tokens per eval request on average,
   jeff counts 86 (DeBERTa tokens of prompt + text) for the same body, a 4.3x ratio. At jev's
   $0.042/M that is ≈ $15.6 per 1M requests; an L4 at the ingress cap (≈ $0.030 per 1M jeff
   tokens) is ≈ $2.6 per 1M requests, and A10G called directly ≈ $0.65. Compare per request,
   not per token.

### Latency (client-observed from a laptop in North America, 8 concurrent clients unless `-c1`)

| run | n | p50 ms | p95 ms | p99 ms | mean tokens |
|---|---:|---:|---:|---:|---:|
| jeff-l4-c1 | 80 | 151 | 170 | 720 | 90 |
| jeff-l4-http | 1600 | 267 | 588 | 1171 | 85 |
| jev+multi/jev-latest | 1600 | 142 | 255 | 369 | 504 |
| jev-c1 | 80 | 129 | 221 | 244 | 377 |
| jev/jev-latest | 1600 | 131 | 237 | 319 | 372 |
| jev/jev-preview | 1600 | 131 | 231 | 338 | 372 |

### choice

| task | run | acc | f1 | ece | pmax | p50_ms | tokens |
|---|---|---:|---:|---:|---:|---:|---:|
| ag_news | jeff-l4-http | 0.750 | 0.723 | 0.173 | 0.920 | 254 | 116 |
| ag_news | jev+multi/jev-latest | 0.905 | 0.905 | 0.064 | 0.952 | 139 | 553 |
| ag_news | jev/jev-latest | 0.905 | 0.905 | 0.062 | 0.952 | 129 | 421 |
| ag_news | jev/jev-preview | 0.900 | 0.900 | 0.066 | 0.953 | 135 | 421 |
| ag_news | large+multi/default | 0.740 | 0.701 | 0.080 | 0.760 | 80 | 231 |
| ag_news | large+multi/isoall | 0.755 | 0.728 | 0.086 | 0.780 | 94 | 344 |
| ag_news | large+multi/noiso | 0.740 | 0.698 | 0.064 | 0.750 | 50 | 175 |
| ag_news | large-t1/default | 0.755 | 0.728 | 0.169 | 0.921 | 34 | 116 |
| ag_news | large/default | 0.755 | 0.728 | 0.086 | 0.780 | 33 | 116 |
| ag_news | large/idname | 0.770 | 0.750 | 0.133 | 0.844 | 27 | 108 |
| ag_news | large/json | 0.755 | 0.728 | 0.169 | 0.921 | 34 | 116 |
| ag_news | large/nodesc | 0.780 | 0.767 | 0.164 | 0.932 | 24 | 78 |
| ag_news | large/single | 0.755 | 0.728 | 0.169 | 0.921 | 31 | 116 |
| emotion | jeff-l4-http | 0.460 | 0.435 | 0.373 | 0.833 | 271 | 101 |
| emotion | jev+multi/jev-latest | 0.480 | 0.454 | 0.366 | 0.846 | 139 | 561 |
| emotion | jev/jev-latest | 0.470 | 0.445 | 0.379 | 0.849 | 126 | 429 |
| emotion | jev/jev-preview | 0.485 | 0.458 | 0.373 | 0.850 | 134 | 429 |
| emotion | large+multi/default | 0.450 | 0.425 | 0.053 | 0.449 | 63 | 185 |
| emotion | large+multi/isoall | 0.470 | 0.448 | 0.037 | 0.495 | 79 | 237 |
| emotion | large+multi/noiso | 0.440 | 0.411 | 0.049 | 0.439 | 39 | 160 |
| emotion | large-t1/default | 0.470 | 0.448 | 0.362 | 0.832 | 23 | 101 |
| emotion | large/default | 0.470 | 0.448 | 0.037 | 0.495 | 23 | 101 |
| emotion | large/idname | 0.455 | 0.432 | 0.279 | 0.734 | 21 | 92 |
| emotion | large/json | 0.470 | 0.448 | 0.362 | 0.832 | 23 | 101 |
| emotion | large/nodesc | 0.455 | 0.422 | 0.447 | 0.902 | 14 | 50 |
| emotion | large/single | 0.470 | 0.448 | 0.362 | 0.832 | 23 | 101 |

### score

| task | run | mae | mae_mid | acc_round | acc_argmax | spearman | p50_ms | tokens |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| amazon | jeff-l4-http | 0.600 | 1.200 | 0.450 | 0.455 | 0.862 | 258 | 105 |
| amazon | jev+multi/jev-latest | 0.466 | 1.200 | 0.620 | 0.615 | 0.891 | 140 | 534 |
| amazon | jev/jev-latest | 0.467 | 1.200 | 0.620 | 0.605 | 0.889 | 131 | 402 |
| amazon | jev/jev-preview | 0.466 | 1.200 | 0.615 | 0.610 | 0.890 | 129 | 402 |
| amazon | large+multi/default | 0.630 | 1.200 | 0.445 | 0.440 | 0.855 | 99 | 221 |
| amazon | large+multi/isoall | 0.600 | 1.200 | 0.450 | 0.455 | 0.861 | 129 | 336 |
| amazon | large+multi/noiso | 0.637 | 1.200 | 0.460 | 0.465 | 0.852 | 62 | 164 |
| amazon | large-t1/default | 0.600 | 1.200 | 0.450 | 0.455 | 0.861 | 40 | 105 |
| amazon | large/default | 0.600 | 1.200 | 0.450 | 0.455 | 0.861 | 41 | 105 |
| amazon | large/idname | 0.603 | 1.200 | 0.425 | 0.435 | 0.859 | 35 | 90 |
| amazon | large/json | 0.602 | 1.200 | 0.480 | 0.475 | 0.860 | 44 | 116 |
| amazon | large/nodesc | 0.600 | 1.200 | 0.450 | 0.455 | 0.861 | 40 | 105 |
| amazon | large/single | 0.600 | 1.200 | 0.450 | 0.455 | 0.861 | 40 | 105 |
| sst5 | jeff-l4-http | 0.611 | 1.200 | 0.415 | 0.450 | 0.829 | 275 | 53 |
| sst5 | jev+multi/jev-latest | 0.493 | 1.200 | 0.570 | 0.540 | 0.882 | 146 | 470 |
| sst5 | jev/jev-latest | 0.489 | 1.200 | 0.570 | 0.550 | 0.883 | 133 | 338 |
| sst5 | jev/jev-preview | 0.490 | 1.200 | 0.560 | 0.550 | 0.882 | 129 | 338 |
| sst5 | large+multi/default | 0.617 | 1.200 | 0.430 | 0.430 | 0.838 | 42 | 139 |
| sst5 | large+multi/isoall | 0.611 | 1.200 | 0.420 | 0.440 | 0.831 | 48 | 194 |
| sst5 | large+multi/noiso | 0.624 | 1.200 | 0.415 | 0.425 | 0.833 | 25 | 112 |
| sst5 | large-t1/default | 0.611 | 1.200 | 0.420 | 0.445 | 0.831 | 13 | 53 |
| sst5 | large/default | 0.611 | 1.200 | 0.420 | 0.440 | 0.831 | 13 | 53 |
| sst5 | large/idname | 0.651 | 1.200 | 0.405 | 0.435 | 0.825 | 12 | 43 |
| sst5 | large/json | 0.611 | 1.200 | 0.420 | 0.445 | 0.831 | 13 | 53 |
| sst5 | large/nodesc | 0.611 | 1.200 | 0.420 | 0.445 | 0.831 | 13 | 53 |
| sst5 | large/single | 0.611 | 1.200 | 0.420 | 0.445 | 0.831 | 13 | 53 |

### noul

| task | run | auroc | acc | brier | ece | mean_p | p50_ms | tokens |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| boolq | jeff-l4-http | 0.751 | 0.700 | 0.266 | 0.236 | 0.554 | 279 | 135 |
| boolq | jev+multi/jev-latest | 0.953 | 0.900 | 0.075 | 0.035 | 0.513 | 138 | 540 |
| boolq | jev/jev-latest | 0.954 | 0.905 | 0.074 | 0.033 | 0.513 | 127 | 408 |
| boolq | jev/jev-preview | 0.953 | 0.900 | 0.075 | 0.047 | 0.514 | 122 | 408 |
| boolq | large+multi/default | 0.750 | 0.690 | 0.209 | 0.081 | 0.536 | 193 | 431 |
| boolq | large+multi/isoall | 0.750 | 0.690 | 0.209 | 0.081 | 0.536 | 198 | 550 |
| boolq | large+multi/noiso | 0.731 | 0.645 | 0.212 | 0.060 | 0.571 | 95 | 194 |
| boolq | large-t1/default | 0.749 | 0.690 | 0.266 | 0.248 | 0.554 | 68 | 135 |
| boolq | large/default | 0.750 | 0.690 | 0.209 | 0.081 | 0.536 | 68 | 135 |
| boolq | large/idname | 0.530 | 0.495 | 0.332 | 0.273 | 0.439 | 65 | 126 |
| boolq | large/json | 0.741 | 0.665 | 0.282 | 0.271 | 0.559 | 70 | 141 |
| boolq | large/nodesc | 0.749 | 0.690 | 0.266 | 0.248 | 0.554 | 67 | 135 |
| boolq | large/single | 0.637 | 0.550 | 0.444 | 0.447 | 0.184 | 68 | 132 |
| irony | jeff-l4-http | 0.716 | 0.680 | 0.291 | 0.268 | 0.449 | 268 | 65 |
| irony | jev+multi/jev-latest | 0.957 | 0.860 | 0.117 | 0.030 | 0.645 | 152 | 469 |
| irony | jev/jev-latest | 0.958 | 0.855 | 0.117 | 0.038 | 0.646 | 138 | 337 |
| irony | jev/jev-preview | 0.957 | 0.855 | 0.118 | 0.035 | 0.645 | 138 | 337 |
| irony | large+multi/default | 0.714 | 0.680 | 0.222 | 0.096 | 0.486 | 44 | 181 |
| irony | large+multi/isoall | 0.714 | 0.680 | 0.222 | 0.096 | 0.486 | 50 | 209 |
| irony | large+multi/noiso | 0.758 | 0.710 | 0.216 | 0.133 | 0.523 | 26 | 124 |
| irony | large-t1/default | 0.714 | 0.680 | 0.292 | 0.279 | 0.448 | 13 | 65 |
| irony | large/default | 0.714 | 0.680 | 0.222 | 0.096 | 0.486 | 13 | 65 |
| irony | large/idname | 0.468 | 0.475 | 0.425 | 0.383 | 0.501 | 12 | 58 |
| irony | large/json | 0.714 | 0.680 | 0.292 | 0.279 | 0.448 | 13 | 65 |
| irony | large/nodesc | 0.494 | 0.465 | 0.464 | 0.461 | 0.543 | 10 | 43 |
| irony | large/single | 0.781 | 0.670 | 0.320 | 0.325 | 0.811 | 12 | 56 |
| sms_spam | jeff-l4-http | 0.919 | 0.860 | 0.121 | 0.096 | 0.537 | 274 | 67 |
| sms_spam | jev+multi/jev-latest | 0.994 | 0.975 | 0.028 | 0.056 | 0.500 | 137 | 474 |
| sms_spam | jev/jev-latest | 0.994 | 0.975 | 0.028 | 0.060 | 0.501 | 139 | 342 |
| sms_spam | jev/jev-preview | 0.995 | 0.980 | 0.027 | 0.059 | 0.502 | 136 | 342 |
| sms_spam | large+multi/default | 0.918 | 0.860 | 0.124 | 0.113 | 0.545 | 52 | 195 |
| sms_spam | large+multi/isoall | 0.918 | 0.860 | 0.124 | 0.113 | 0.545 | 56 | 230 |
| sms_spam | large+multi/noiso | 0.900 | 0.860 | 0.164 | 0.228 | 0.514 | 29 | 126 |
| sms_spam | large-t1/default | 0.918 | 0.860 | 0.121 | 0.109 | 0.538 | 16 | 67 |
| sms_spam | large/default | 0.918 | 0.860 | 0.124 | 0.113 | 0.545 | 16 | 67 |
| sms_spam | large/idname | 0.477 | 0.495 | 0.374 | 0.310 | 0.587 | 14 | 61 |
| sms_spam | large/json | 0.918 | 0.860 | 0.121 | 0.109 | 0.538 | 16 | 67 |
| sms_spam | large/nodesc | 0.934 | 0.875 | 0.103 | 0.072 | 0.537 | 12 | 48 |
| sms_spam | large/single | 0.932 | 0.855 | 0.129 | 0.129 | 0.401 | 13 | 57 |
| sst2 | jeff-l4-http | 0.992 | 0.960 | 0.038 | 0.037 | 0.503 | 265 | 44 |
| sst2 | jev+multi/jev-latest | 0.995 | 0.970 | 0.038 | 0.090 | 0.474 | 149 | 430 |
| sst2 | jev/jev-latest | 0.996 | 0.970 | 0.037 | 0.090 | 0.474 | 127 | 298 |
| sst2 | jev/jev-preview | 0.995 | 0.970 | 0.038 | 0.090 | 0.474 | 126 | 298 |
| sst2 | large+multi/default | 0.991 | 0.960 | 0.036 | 0.072 | 0.517 | 45 | 156 |
| sst2 | large+multi/isoall | 0.991 | 0.960 | 0.036 | 0.072 | 0.517 | 47 | 183 |
| sst2 | large+multi/noiso | 0.993 | 0.965 | 0.049 | 0.128 | 0.536 | 24 | 103 |
| sst2 | large-t1/default | 0.991 | 0.960 | 0.038 | 0.038 | 0.503 | 12 | 44 |
| sst2 | large/default | 0.991 | 0.960 | 0.036 | 0.072 | 0.517 | 12 | 44 |
| sst2 | large/idname | 0.969 | 0.880 | 0.084 | 0.054 | 0.562 | 11 | 34 |
| sst2 | large/json | 0.991 | 0.960 | 0.038 | 0.038 | 0.503 | 12 | 44 |
| sst2 | large/nodesc | 0.991 | 0.960 | 0.038 | 0.038 | 0.503 | 12 | 44 |
| sst2 | large/single | 0.857 | 0.820 | 0.171 | 0.163 | 0.339 | 11 | 41 |

### Averages over tasks

| run | choice acc | score mae | noul auroc | noul acc | p50 ms | tokens |
|---|---:|---:|---:|---:|---:|---:|
| jeff-l4-http | 0.605 | 0.605 | 0.844 | 0.800 | 268 | 86 |
| jev+multi/jev-latest | 0.693 | 0.480 | 0.975 | 0.926 | 142 | 504 |
| jev/jev-latest | 0.688 | 0.478 | 0.975 | 0.926 | 131 | 372 |
| jev/jev-preview | 0.693 | 0.478 | 0.975 | 0.926 | 131 | 372 |
| large+multi/default | 0.595 | 0.623 | 0.843 | 0.797 | 77 | 217 |
| large+multi/isoall | 0.613 | 0.605 | 0.843 | 0.797 | 88 | 285 |
| large+multi/noiso | 0.590 | 0.630 | 0.845 | 0.795 | 44 | 145 |
| large-t1/default | 0.613 | 0.605 | 0.843 | 0.797 | 27 | 86 |
| large/default | 0.613 | 0.605 | 0.843 | 0.797 | 27 | 86 |
| large/idname | 0.613 | 0.627 | 0.611 | 0.586 | 25 | 76 |
| large/json | 0.613 | 0.606 | 0.841 | 0.791 | 28 | 88 |
| large/nodesc | 0.618 | 0.605 | 0.792 | 0.747 | 24 | 70 |
| large/single | 0.613 | 0.605 | 0.802 | 0.724 | 26 | 83 |

### Agreement with jev/jev-latest (same items)

| task | run | choice agree | score corr | score mean abs diff | noul corr | noul agree@0.5 |
|---|---|---:|---:|---:|---:|---:|
| ag_news | jeff-l4-http | 0.805 |  |  |  |  |
| ag_news | jev+multi/jev-latest | 0.990 |  |  |  |  |
| ag_news | jev/jev-preview | 0.995 |  |  |  |  |
| ag_news | large+multi/default | 0.795 |  |  |  |  |
| ag_news | large+multi/isoall | 0.810 |  |  |  |  |
| ag_news | large+multi/noiso | 0.795 |  |  |  |  |
| ag_news | large-t1/default | 0.810 |  |  |  |  |
| ag_news | large/default | 0.810 |  |  |  |  |
| ag_news | large/idname | 0.825 |  |  |  |  |
| ag_news | large/json | 0.810 |  |  |  |  |
| ag_news | large/nodesc | 0.835 |  |  |  |  |
| ag_news | large/single | 0.810 |  |  |  |  |
| amazon | jeff-l4-http |  | 0.941 | 0.383 |  |  |
| amazon | jev+multi/jev-latest |  | 1.000 | 0.017 |  |  |
| amazon | jev/jev-preview |  | 1.000 | 0.017 |  |  |
| amazon | large+multi/default |  | 0.937 | 0.416 |  |  |
| amazon | large+multi/isoall |  | 0.941 | 0.383 |  |  |
| amazon | large+multi/noiso |  | 0.936 | 0.419 |  |  |
| amazon | large-t1/default |  | 0.941 | 0.383 |  |  |
| amazon | large/default |  | 0.941 | 0.383 |  |  |
| amazon | large/idname |  | 0.942 | 0.410 |  |  |
| amazon | large/json |  | 0.938 | 0.419 |  |  |
| amazon | large/nodesc |  | 0.941 | 0.383 |  |  |
| amazon | large/single |  | 0.941 | 0.383 |  |  |
| boolq | jeff-l4-http |  |  |  | 0.547 | 0.735 |
| boolq | jev+multi/jev-latest |  |  |  | 0.999 | 0.995 |
| boolq | jev/jev-preview |  |  |  | 0.999 | 0.995 |
| boolq | large+multi/default |  |  |  | 0.567 | 0.735 |
| boolq | large+multi/isoall |  |  |  | 0.567 | 0.735 |
| boolq | large+multi/noiso |  |  |  | 0.580 | 0.710 |
| boolq | large-t1/default |  |  |  | 0.548 | 0.735 |
| boolq | large/default |  |  |  | 0.567 | 0.735 |
| boolq | large/idname |  |  |  | 0.126 | 0.530 |
| boolq | large/json |  |  |  | 0.545 | 0.720 |
| boolq | large/nodesc |  |  |  | 0.548 | 0.735 |
| boolq | large/single |  |  |  | 0.189 | 0.565 |
| emotion | jeff-l4-http | 0.600 |  |  |  |  |
| emotion | jev+multi/jev-latest | 0.985 |  |  |  |  |
| emotion | jev/jev-preview | 0.975 |  |  |  |  |
| emotion | large+multi/default | 0.635 |  |  |  |  |
| emotion | large+multi/isoall | 0.610 |  |  |  |  |
| emotion | large+multi/noiso | 0.635 |  |  |  |  |
| emotion | large-t1/default | 0.610 |  |  |  |  |
| emotion | large/default | 0.610 |  |  |  |  |
| emotion | large/idname | 0.655 |  |  |  |  |
| emotion | large/json | 0.610 |  |  |  |  |
| emotion | large/nodesc | 0.625 |  |  |  |  |
| emotion | large/single | 0.610 |  |  |  |  |
| irony | jeff-l4-http |  |  |  | 0.429 | 0.665 |
| irony | jev+multi/jev-latest |  |  |  | 0.999 | 0.995 |
| irony | jev/jev-preview |  |  |  | 0.999 | 1.000 |
| irony | large+multi/default |  |  |  | 0.436 | 0.665 |
| irony | large+multi/isoall |  |  |  | 0.436 | 0.665 |
| irony | large+multi/noiso |  |  |  | 0.470 | 0.725 |
| irony | large-t1/default |  |  |  | 0.430 | 0.665 |
| irony | large/default |  |  |  | 0.436 | 0.665 |
| irony | large/idname |  |  |  | -0.081 | 0.480 |
| irony | large/json |  |  |  | 0.430 | 0.665 |
| irony | large/nodesc |  |  |  | 0.019 | 0.540 |
| irony | large/single |  |  |  | 0.564 | 0.785 |
| sms_spam | jeff-l4-http |  |  |  | 0.753 | 0.855 |
| sms_spam | jev+multi/jev-latest |  |  |  | 1.000 | 1.000 |
| sms_spam | jev/jev-preview |  |  |  | 1.000 | 0.995 |
| sms_spam | large+multi/default |  |  |  | 0.764 | 0.855 |
| sms_spam | large+multi/isoall |  |  |  | 0.764 | 0.855 |
| sms_spam | large+multi/noiso |  |  |  | 0.722 | 0.865 |
| sms_spam | large-t1/default |  |  |  | 0.753 | 0.855 |
| sms_spam | large/default |  |  |  | 0.764 | 0.855 |
| sms_spam | large/idname |  |  |  | 0.006 | 0.490 |
| sms_spam | large/json |  |  |  | 0.753 | 0.855 |
| sms_spam | large/nodesc |  |  |  | 0.794 | 0.870 |
| sms_spam | large/single |  |  |  | 0.749 | 0.850 |
| sst2 | jeff-l4-http |  |  |  | 0.892 | 0.950 |
| sst2 | jev+multi/jev-latest |  |  |  | 1.000 | 1.000 |
| sst2 | jev/jev-preview |  |  |  | 1.000 | 1.000 |
| sst2 | large+multi/default |  |  |  | 0.916 | 0.950 |
| sst2 | large+multi/isoall |  |  |  | 0.916 | 0.950 |
| sst2 | large+multi/noiso |  |  |  | 0.921 | 0.945 |
| sst2 | large-t1/default |  |  |  | 0.892 | 0.950 |
| sst2 | large/default |  |  |  | 0.916 | 0.950 |
| sst2 | large/idname |  |  |  | 0.809 | 0.870 |
| sst2 | large/json |  |  |  | 0.892 | 0.950 |
| sst2 | large/nodesc |  |  |  | 0.892 | 0.950 |
| sst2 | large/single |  |  |  | 0.700 | 0.830 |
| sst5 | jeff-l4-http |  | 0.880 | 0.535 |  |  |
| sst5 | jev+multi/jev-latest |  | 1.000 | 0.026 |  |  |
| sst5 | jev/jev-preview |  | 1.000 | 0.023 |  |  |
| sst5 | large+multi/default |  | 0.884 | 0.542 |  |  |
| sst5 | large+multi/isoall |  | 0.881 | 0.534 |  |  |
| sst5 | large+multi/noiso |  | 0.882 | 0.555 |  |  |
| sst5 | large-t1/default |  | 0.881 | 0.534 |  |  |
| sst5 | large/default |  | 0.881 | 0.534 |  |  |
| sst5 | large/idname |  | 0.858 | 0.554 |  |  |
| sst5 | large/json |  | 0.881 | 0.534 |  |  |
| sst5 | large/nodesc |  | 0.881 | 0.534 |  |  |
| sst5 | large/single |  | 0.881 | 0.534 |  |  |

### Temperature fit (bench/calibrate.py, run `large-t1/default`)

| kind | task | n | T (fit on task) | T (other tasks of kind) | T (all other tasks) | ECE raw | ECE @T-kind | ECE @T-all | NLL raw | NLL @T-all |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| choice | ag_news | 200 | 3.10 | 3.30 | 3.20 | 0.169 | 0.087 | 0.096 | 0.961 | 0.533 |
| choice | emotion | 200 | 3.30 | 3.10 | 3.15 | 0.362 | 0.048 | 0.052 | 2.332 | 1.408 |
| noul | boolq | 200 | 4.65 | 2.60 | 3.10 | 0.248 | 0.111 | 0.083 | 1.133 | 0.614 |
| noul | irony | 200 | 4.80 | 2.60 | 3.10 | 0.279 | 0.137 | 0.102 | 1.155 | 0.639 |
| noul | sms_spam | 200 | 1.80 | 3.40 | 3.30 | 0.109 | 0.124 | 0.119 | 0.434 | 0.416 |
| noul | sst2 | 200 | 1.95 | 3.45 | 3.30 | 0.038 | 0.076 | 0.072 | 0.177 | 0.159 |
| score | amazon | 200 | 3.45 | 3.15 | 3.10 | 0.410 | 0.119 | 0.124 | 2.057 | 1.178 |
| score | sst5 | 200 | 3.15 | 3.45 | 3.20 | 0.369 | 0.061 | 0.098 | 1.918 | 1.192 |

Global T on all rows: 3.20
  choice: T = 3.20
  score: T = 3.30
  noul: T = 3.00

