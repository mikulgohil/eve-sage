# eve-sage — Design Spec

**Date:** 2026-06-18
**Status:** Approved (brainstorming complete)
**Author:** Mikul Gohil

## Goal

Build a production-grade **agentic RAG agent** on Vercel's [eve](https://eve.dev) framework that
answers questions about eve and the Vercel AI stack with citations — and serves as a clean,
public reference implementation of eve. Portfolio piece optimized to demonstrate *deep AI
engineering* (agentic retrieval + a real eval harness in CI), not a weekend chatbot.

## Scope (in)

- An eve agent (`agent/`) whose corpus is the **eve / AI SDK / Workflow SDK docs**.
- A retrieval stack: **contextual chunking → hybrid search (pgvector + Postgres FTS, fused with RRF) → reranking → agentic multi-hop**.
- Two declared **subagents**: `retriever` (search + rerank + multi-hop) and `verifier` (groundedness self-check, can force re-retrieve).
- An **eval suite** (golden Q&A set; recall@k, MRR, faithfulness, correctness, citation accuracy) wired into **GitHub Actions** with a PR score-delta comment.
- Three **channels**: built-in HTTP + Next.js web widget, Slack, GitHub.
- **Human-in-the-loop approval** before public posts (e.g. GitHub replies) or on low-confidence answers.
- **OpenTelemetry tracing** per run, with a trace screenshot in the README.
- Deployment to **Vercel**.

## Non-goals (out)

- Multi-tenant / auth-gated SaaS, billing, user accounts.
- Corpus beyond the eve / Vercel AI stack docs (no arbitrary web RAG).
- Fine-tuning or training custom models.
- A polished marketing site beyond the chat widget.

## Success criteria

- Live deployed URL answering eve questions with inline citations.
- All three channels (web, Slack, GitHub) functional from one codebase.
- CI eval gate green; a change that regresses retrieval is caught in PR.
- Documented eval lift across the four pipeline layers (naive → hybrid → +rerank → +verifier).
- README a stranger can follow to run it locally.

## Constraints

- **eve** (beta): filesystem-first; Node **24+**; installs `eve`, `ai`, `zod`. Scaffold via `npx eve@latest init`.
- **Models:** Anthropic **Claude Opus 4.8** for answers, a cheaper model (e.g. Sonnet 4.6 / Haiku) as the LLM judge, via **AI Gateway** (`AI_GATEWAY_API_KEY`) or direct (`ANTHROPIC_API_KEY` + `@ai-sdk/anthropic`).
- **Embeddings:** Voyage (via AI Gateway). **Vector store:** Postgres + pgvector (Neon / Vercel Postgres).
- **Web UI:** Next.js 16 (App Router) + Tailwind v4 + TypeScript strict — added via `eve init --channel-web-nextjs`.
- **Sandbox:** Docker locally, Vercel Sandbox in prod. Tools run in the *app runtime* (have `process.env`), not the sandbox.
- TS strict, pnpm, kebab-case, conventional commits, no AI co-author line.

## Architecture (pinned to real eve APIs)

```
agent/
  agent.ts                  # defineAgent({ model: "anthropic/claude-opus-4.8" })
  instructions.md           # doc-expert persona: cite, admit uncertainty
  tools/
    search_docs.ts          # defineTool — hybrid retrieval over pgvector + Postgres FTS
    fetch_chunk.ts          # defineTool — full passage by id for citation
  skills/
    citation-style.md       # answer/citation format
  subagents/
    retriever/agent.ts      # defineAgent({ description, model }) — multi-hop search+rerank
    verifier/agent.ts       # defineAgent({ description, model }) — groundedness check
  channels/
    eve.ts                  # built-in HTTP channel (always present)
    slack.ts
    github.ts
  schedules/
    reindex.ts              # weekly re-scrape + re-embed (root-only)
  connections/              # if GitHub/Slack go via MCP: defineMcpClientConnection
  lib/                      # shared retrieval helpers (db client, RRF, rerank)
ingestion/                  # scrape → contextual chunk → embed → upsert to pgvector
evals/                      # golden set + scorers
web/                        # Next.js 16 chat UI (from --channel-web-nextjs)
.github/workflows/eval.yml  # CI eval gate
```

Key API facts confirmed from eve docs (2026-06-18):
- `defineTool` from `eve/tools`: `{ description, inputSchema (zod), execute(input, ctx), outputSchema?, needsApproval?, toModelOutput? }`. Filename = model-facing tool name.
- Approval helpers from `eve/tools/approval`: `always()`, `once()`, `never()`, or a predicate.
- `ctx` gives `ctx.session`, `ctx.getSandbox()`, `ctx.getSkill(id)`.
- Declared subagent: `agent/subagents/<id>/agent.ts` must export a `description`; registers as tool `<id>`. Inherits nothing from root — duplicate skills/tools it needs. No `schedules`/`channels` inside a subagent.
- Built-in `agent` tool delegates to a copy of the agent (shares sandbox/tools) for parallel fan-out.
- `defineMcpClientConnection` from `eve/connections`: `{ url, description, auth.getToken, headers?, tools.allow|block? }`.

> **To resolve in M1/M2:** the exact Evals and Channels API pages — those nav entries are doc *groups*, not single pages. Confirm `evals/` file layout and `defineChannel` signature against eve.dev before coding M2/M3.

## Plan (rough — milestones, each independently shippable)

1. **M1 — Core:** scaffold (`eve init --channel-web-nextjs`); ingestion (scrape eve docs → contextual chunk → Voyage embed → pgvector); `search_docs` + `fetch_chunk` tools (hybrid + RRF + rerank); root agent + instructions; eval harness skeleton + golden set v1; web widget answering with citations.
2. **M2 — Agentic:** `retriever` + `verifier` subagents; multi-hop + groundedness re-retrieve; fill the benchmark table with real eval runs across the four layers.
3. **M3 — Surface:** Slack + GitHub channels; approval gate on public posts / low confidence; OpenTelemetry trace screenshots.
4. **M4 — Polish:** CI eval gate (`eval.yml`) commenting score delta; architecture docs; deploy to Vercel; launch.

## Open questions / assumptions

- **Slack/GitHub integration path:** native eve channel adapters vs. MCP connections — decide in M3 against the (currently unresolved) Channels docs.
- **Reranker:** Voyage rerank vs. Cohere — pick in M1 by cost/quality; abstract behind `lib/rerank.ts`.
- **Postgres host:** Neon vs. Vercel Postgres — either works; default Neon for free-tier dev, swap via `DATABASE_URL`.
- **Assumption:** Anthropic + Voyage credentials available via AI Gateway or direct keys.

## Estimated effort

Multi-day (flagship). M1 ≈ 1–2 evenings; M2–M4 each ≈ 1–2 evenings.
