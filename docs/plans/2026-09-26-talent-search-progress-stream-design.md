# AI Talent Search Progress Stream Design

## Goal

Show the real backend work behind talent search as a live, inspectable process, including resume retrieval and per-candidate evaluation.

## Pipeline Nodes

| Node | Backend work | Streamed evidence |
| --- | --- | --- |
| `requirements` | Extract the role rubric from the JD, unless the user already supplied one | Requirement and knockout counts |
| `resume_scan` | Apply tenant/project access rules and load each candidate's latest non-empty parsed resume | Accessible candidate count and readable resume count |
| `keyword_retrieval` | Extract JD/rubric signals, count keyword hits, and rank resumes for evaluation | Keyword samples, recalled resume count, and evaluation limit |
| `evaluation` | Evaluate the top eight resumes sequentially | Candidate name, position, keyword hits, running/completed state, and score |
| `ranking` | Sort completed evaluations by total score and persist the result | Evaluated count and final ordering state |

Search reuses stored parsed resume text; it does not re-run document parsing or OCR. Events must not include resume text.

## Transport And Persistence

Store sequenced progress events in each existing `turns_json` entry. An authenticated SSE endpoint replays events after `Last-Event-ID`, reading the persisted event list so reconnects and page refreshes do not depend on an in-memory queue. This requires no database migration. Each event contains `id`, `node`, `status`, `message`, optional `detail`/`data`, and `created_at`.

The frontend renders these events as five clickable nodes and an evaluation activity list. Counts and candidate scores come only from backend results; there is no estimated percentage. Existing rubric editing, retry, and follow-up conversation actions remain available.

## Implementation And Verification

1. Add optional progress callbacks to candidate matching and persist events on the active turn.
2. Add an authenticated, resumable SSE route and test replay/authorization.
3. Consume SSE in the talent-search page and render live node and candidate updates.
4. Run the focused recruiting API tests, the web build, page lint, and browser checks for live updates and narrow layouts.