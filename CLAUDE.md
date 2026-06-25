# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

### Frontend (Next.js — runs from project root)

```bash
npm run dev          # Start Next.js dev server (localhost:3000)
npm run build        # Production build to .next/
npm run start        # Start production server
npm run lint         # ESLint 9 flat config check (core-web-vitals + typescript)
npm test             # Start Vitest in watch mode
npm run test:run     # Vitest single run
npx vitest run -t "test name"  # Run a single test
```

### Worker (standalone process — run from `worker/`)

```bash
cd worker
npm run dev          # nodemon + ts-node (watch mode, port 3001)
npm run build        # tsc → dist/
npm run start        # node dist/index.js
```

### Running both for development

In separate terminals:

1. `cd worker && npm run dev` (background job processor + health endpoint)
2. `npm run dev` (frontend)

### Mock mode

```
MOCK_MODE=true    # Worker uses MockAdapter — no real API calls
```

## Architecture

### Dual-process system

- **Next.js frontend** (root): App Router, Supabase auth, job submission, progress/report views
- **Worker** (`worker/`): Standalone Node.js process using pg-boss to poll `parse-job` and `search-job` queues. Adapts to multiple AI APIs via factory pattern

### Data flow

```
User uploads patent document (step-1)
  → API creates patent_documents row + enqueues parse-job
  → Worker parses file (PDF/DOCX/XLSX/TXT), calls AI model, updates parsed_data
User configures search (step-2): selects models × strategies, limits, report model
  → API creates search_jobs row + enqueues search-job
  → Worker creates search_tasks (Cartesian product model_id × strategy_id)
  → Worker iterates tasks calling AI, collects results, deduplicates by URL
  → Worker generates HTML report via AI (top-N selection + path summaries)
  → User sees real-time progress (React Flow / Supabase Realtime) then report (step-3)
```

### Key directories

| Directory              | Purpose                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| `app/`                 | Next.js App Router — pages, API routes, layouts                                                  |
| `components/`          | React components by domain: `ui/` (shadcn), `wizard/`, `flow/`, `report/`, `settings/`           |
| `lib/`                 | Shared utilities: Supabase clients (`client.ts`, `server.ts`, `admin.ts`), pg-boss client, types |
| `worker/src/`          | Worker entry, handlers, adapters, parsers, services                                              |
| `supabase/migrations/` | SQL migrations (idempotent, sequentially numbered)                                               |
| `__tests__/`           | Vitest frontend tests; `worker/__tests__/` for worker                                            |

### Supabase client variants

1. **Browser** (`lib/supabase/client.ts`) — anon key, for client components
2. **Server** (`lib/supabase/server.ts`) — cookie-based auth, for RSC and Route Handlers
3. **Service** (`lib/supabase/admin.ts`) — service role key, bypasses RLS, for privileged server ops

### AI adapter factory (`worker/src/adapters/index.ts`)

`createAdapter(model)` returns the correct adapter based on `model.adapter_config.provider`:

- `metaso` → `MetasoAdapter` (specialized search API, POST to `/v1/search`)
- Default → `OpenAICompatAdapter` (generic OpenAI-compatible, POST to `/chat/completions`)
- All overridden by `MockAdapter` when `MOCK_MODE=true`

### Database

- **8 tables**: profiles, ai_models, search_strategies, patent_documents, search_jobs, search_tasks, reports, notifications
- **RLS enabled** on all tables; built-in models/strategies readable by all, user-owned data scoped by user_id
- **Migrations** in `supabase/migrations/` — must be idempotent (`IF NOT EXISTS`, `DROP IF EXISTS`, DO blocks)

### Types

- Frontend shared types: `lib/supabase/types.ts`
- Worker duplicates needed types independently (worker is CommonJS, frontend is ESM, no cross-import)

## Environment

- **OS**: Windows 11. Shell commands must work in PowerShell/CMD, not WSL/Unix only
- **Package manager**: npm (not pnpm or yarn)
- **Env vars** (copy `.env.local.example`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `WORKER_URL`
- **Node**: check `package.json` engines; TypeScript 5+ in frontend, TypeScript 6 in worker

## Conventions

### External API integration

- Before modifying any AI model adapter (Kimi, GLM, MiniMax, Qwen, Metaso, etc.), consult official docs or ask user for API reference
- Never guess base URLs, auth headers, or request body formats — 2026 APIs may differ from training data
- Validate changes with the `test-*.js` scripts or actual HTTP requests, not just code review

### Database migrations

- All SQL must be idempotent: use `IF NOT EXISTS`, `DROP IF EXISTS`, DO blocks
- pg/pg-boss connections must configure `poolSize` and release on exit
- No irreversible data deletion in migrations without explicit user request + backup

### Build verification

- After source changes, run the full build and check actual `dist/` or `.next/` output
- On Windows, build tools may inject watermarks/CDN scripts/absolute paths — investigate anything not in source
- Preview with local server (`npx serve` or `npm start`), never `file://` protocol

### Error resilience

- External API call failures: retry max 2 times, then report + propose alternatives (Mock mode, smaller batch, skip model)
- Chinese character ByteString errors → switch to ASCII-safe communication, check encoding and account status
- Research solutions independently; escalate to user only when a decision is needed

### File operations

- Read before write; parallel edits for multi-file changes; verify with build
- Never commit `.env`, keys, or credentials
