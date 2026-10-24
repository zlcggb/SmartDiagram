# jeff

A self-hosted implementation of TypeSafe's [jev System One API](https://docs.typesafe.ai/api),
powered by [GLiFormer](https://huggingface.co/knowledgator/gliformer-large-v1) (400M parameters).
Use the official `typesafe-sdk` by pointing `TYPESAFE_BASE_URL` at jeff.

Supports `choice` (pick an option), `score` (rate on ordered levels), and `noul` (probability of yes).
Cheaper to self-host, but less accurate than jev on reasoning-heavy tasks. See [benchmarks](#benchmarks).

[Quickstart](#quickstart) · [Deploy](#deploy-on-modal) · [Configuration](#configuration) · [API](#api-and-compatibility) · [Development](#development)

## Quickstart

Requires [uv](https://docs.astral.sh/uv/) and Python 3.12. Run from the repository root:

```bash
uv sync --extra dev
uv run hf download knowledgator/gliformer-large-v1 --local-dir models/gliformer-large-v1
JEFF_API_KEYS=devkey uv run jeff
```

Serves at `http://localhost:8000`. Device selection: CUDA → MPS → CPU.

The sync above also installs `typesafe-sdk`. Save this as `example.py`:

```python
from typesafe_sdk import Choice, Noul, Score, TypeSafeClient

client = TypeSafeClient(api_key="devkey", base_url="http://localhost:8000")
result = client.system_one(
    "I was charged twice. Please help ASAP.",
    {
        "billing": Noul(instructions="Is this about billing?"),
        "tone": Choice(
            instructions="What is the tone?",
            criteria={"calm": None, "angry": "hostile"},
        ),
        "urgency": Score(
            instructions="How urgent is this?", criteria=["low", "medium", "high"]
        ),
    },
)
print(result.nouls["billing"].noul)
print(result.choices["tone"].choice)
print(result.scores["urgency"].score)
```

In another terminal:

```bash
uv run python example.py
```

For an existing SDK app, set `TYPESAFE_API_KEY=devkey` and
`TYPESAFE_BASE_URL=http://localhost:8000` instead of passing client arguments.

<details>
<summary>curl example</summary>

```bash
curl http://localhost:8000/v1/systemone \
  -H 'Authorization: Bearer devkey' \
  -H 'Content-Type: application/json' \
  -d '{
    "state": "The export button crashes in Safari.",
    "model": "jev-latest",
    "questions": {
      "severity": {
        "type": "score",
        "instructions": "How severe?",
        "criteria": ["cosmetic", "degraded", "blocking"]
      }
    }
  }'
```

</details>

## Deploy on Modal

Use L4 for the HTTP API. These commands download weights once and deploy with one warm container:

```bash
uv run modal setup
uv run modal run deploy/modal_gpu.py::download
JEFF_GPU=L4 JEFF_API_KEYS=k1 uv run modal deploy deploy/modal_gpu.py
```

For an ephemeral URL with no warm container:

```bash
JEFF_API_KEYS=devkey uv run modal serve deploy/modal_gpu.py
```

Deploy settings: `JEFF_GPU=L4`, `JEFF_MIN_CONTAINERS=1`, `JEFF_MAX_CONTAINERS=8`,
`JEFF_MAX_INPUTS=64`, `JEFF_TARGET_INPUTS=16`. Server `JEFF_*` variables are forwarded.
The GPU image defaults to batch size 32, batch wait 10 ms, and warmup enabled.

Measured HTTP throughput caps at ~50 requests/s per container; scale containers for more.
A10G performs better for direct backend calls and long requests. See [results](bench/RESULTS.md).

<details>
<summary>CPU / ONNX deployment</summary>

ONNX Runtime runs the encoder; the RNN and classification head stay in PyTorch.
CPU is a fallback: the measured 8-core Modal deployment was slower and more expensive than jev.
On Mac, prefer MPS.

```bash
uv sync --extra onnx
uv run python scripts/export_onnx.py models/gliformer-large-v1 --int8
JEFF_BACKEND=onnx JEFF_QUANT=int8 JEFF_THREADS=8 JEFF_API_KEYS=devkey uv run jeff
```

Or deploy to Modal:

```bash
uv run modal run deploy/modal_cpu.py::export
JEFF_CPU=8 JEFF_QUANT=int8 JEFF_API_KEYS=k1 uv run modal deploy deploy/modal_cpu.py
```

</details>

## Configuration

Set environment variables before starting the server.

| Variable | Default | Purpose |
|---|---|---|
| `JEFF_API_KEYS` | empty (auth off) | Comma-separated bearer keys |
| `JEFF_MODEL` | `models/gliformer-large-v1` | Local checkpoint path |
| `JEFF_DEVICE` | auto | `cuda`, `mps`, or `cpu` |
| `JEFF_HOST` / `JEFF_PORT` | `0.0.0.0` / `8000` | Listen address |
| `JEFF_MAX_BATCH` / `JEFF_MAX_WAIT_MS` | `16` / `5` | Batch size / wait in ms |
| `JEFF_MAX_QUEUE` | `256` | Queued requests before HTTP 529 |
| `JEFF_RATE_LIMIT_RPS` / `JEFF_RATE_LIMIT_BURST` | `0` (off) / `20` | Per-key rate limit |
| `JEFF_MAX_QUESTIONS` / `JEFF_MAX_LABELS` / `JEFF_MAX_STATE_CHARS` | `64` / `64` / `20000` | Request limits; exceeded limits return 422 |

<details>
<summary>Model and backend settings</summary>

| Variable | Default | Purpose |
|---|---|---|
| `JEFF_MODEL_NAME` | `gliformer-large-v1` | Name in responses and model listing |
| `JEFF_MODEL_ALIASES` | `jev-latest,jev` | Accepted request model aliases |
| `JEFF_BACKEND` | `torch` | `torch` or `onnx` |
| `JEFF_DTYPE` | bf16 on CUDA, fp32 elsewhere | Model precision |
| `JEFF_TEMPERATURE` | `3.2` | Probability calibration; `1` disables scaling |
| `JEFF_ISOLATE` | `nouls` | Separate encoder passes: `none`, `nouls`, `all` |
| `JEFF_NOUL_MODE` | `yes_no` | `yes_no`, `single`, `single_named` |
| `JEFF_STATE_FORMAT` | `kv` | Object/array rendering: `kv`, `json`, `values` |
| `JEFF_ATTN` | `auto` | `auto`, `flash` (CUDA), or `eager` |
| `JEFF_COMPILE` / `JEFF_COMPILE_MODE` / `JEFF_PAD_MULTIPLE` | `0` / unset / `0` | Compilation and padding options |
| `JEFF_WARMUP` | `0` | Warmup at startup |
| `JEFF_QUANT` / `JEFF_THREADS` / `JEFF_ONNX_PATH` | `fp32` / auto / auto | ONNX precision, thread count, encoder path |

For faster local iteration, download `knowledgator/gliformer-base-v1`, set `JEFF_MODEL`
to its path, and use `JEFF_NOUL_MODE=single` for usable noul results.

</details>

## API and compatibility

| Endpoint | Purpose |
|---|---|
| `POST /v1/systemone` | Answer classification questions |
| `GET /v1/models` | List models and aliases |
| `GET /healthz` | Health check |
| `GET /stats` | Batcher counters and active configuration |

Errors: **401** invalid key, **422** validation or request limit, **429** rate limit
(`retry-after-ms`), **529** full queue. Responses include `x-typesafe-request-id`,
`x-jeff-server-ms`, and `x-jeff-batcher-ms`.

The wire format works with the official SDK; model behavior differs:

- **Probabilities:** normalized sigmoids, temperature-scaled at 3.2. `score` uses the raw
  distribution, so it only matches the weighted average of displayed probabilities at
  `JEFF_TEMPERATURE=1`. Confidence uses `(p_max - 1/n) / (1 - 1/n)`.
- **Question independence:** nouls get separate encoder passes; choice and score questions
  share a pass and can affect each other. Set `JEFF_ISOLATE=all` for independence at extra cost.
- **Tokens:** `usage.input_tokens` counts DeBERTa prompt + text tokens; `output_tokens` is nominal.
  Counts are not comparable to jev billing.

## Benchmarks

Measured on 1,600 labeled items across eight datasets:

| Comparison | jeff | jev |
|---|---:|---:|
| Sequential p50 latency from a laptop | 151 ms (L4 / Modal HTTP) | 129 ms |
| Cost per 1M single-question requests | ~$2.6 (L4 / Modal HTTP) | ~$15.6 |
| AG News topic accuracy | 75.5% | 90.5% |
| [JevBench](https://github.com/fstandhartinger/jevbench) v1.2.2 score (official, rank of 18) | 66.9 (#9) | 75.3 (#2) |
| JevBench Intelligence (easy / standard / judge / hard accuracy) | 63.9 (100 / 76 / 62 / 38%) | 90.4 (100 / 99 / 95 / 74%) |

jeff is close on binary sentiment, tied on emotion classification, and substantially behind
on irony, reading comprehension, and JevBench's judge and hard tiers. On JevBench its rank
comes from cost; it is #14 of 18 on intelligence. Costs depend on workload and utilization.
[Full results, methodology, and reproduction commands →](bench/RESULTS.md) ·
[JevBench leaderboard →](https://benchmarkheaven.com/jev-models)

## Development

```bash
uv sync --extra dev
uv run pytest -q
```

Model integration tests need `models/gliformer-base-v1`; they skip if it is absent.
The [SDK tests](tests/test_sdk_live.py) use a live server with a fake backend.

Code: [core](src/jeff/core/) · [backends](src/jeff/backends/) · [server](src/jeff/server/) ·
[deploy](deploy/) · [bench](bench/)

## License

MIT. See [LICENSE](LICENSE).
