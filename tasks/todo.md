# Prime Radiant — build plan

Decisions locked (2026-08-19):
- v1 runs **real Seldon predictions**, not a waitlist.
- **Anonymous** everywhere; upvotes + rate limits deduped on salted IP+UA hash.
- Caps: 10 MB/file, 200k rows, 200 cols, 3 uploads/day/identity, 7-day file TTL, 5 GB global.

## Architecture
Next.js 16 (App Router, TS, Tailwind 4) on Vercel + one **Python** function for
inference (preprocessing parity with the canonical `predict.py`; parquet needs pyarrow).

Upload flow — file goes **direct to Supabase Storage** via signed URL, never through Vercel:
1. `POST /api/jobs` (TS) → rate-check, create job row, return signed upload URL
2. client PUTs file straight to Storage
3. `POST /api/inspect` (PY) → validate rows/cols, return columns + candidate targets
4. user picks target column
5. `POST /api/predict` (PY) → Seldon, write predictions CSV to Storage, return preview + download URL

Target-column model: one file. Rows with the target filled = in-context examples,
rows with it empty = the rows to predict. No train/test split to explain.

## Tasks
- [ ] Switch `gh` to the `theomarco` account
- [ ] Scaffold Next.js app, wire Tailwind
- [ ] Supabase schema + RLS: `jobs`, `ideas`, `idea_votes`; private `uploads` bucket
- [ ] Landing page (manifesto)
- [ ] `/predict` — upload → target picker → results
- [ ] `/board` — 2-question form + upvotes
- [ ] Python inference function (`inspect` + `predict`)
- [ ] Env vars local + Vercel
- [ ] Deploy, verify end-to-end with a real CSV
- [ ] Push to github.com/theomarco/prime-radiant

## Flagged
- Legacy Supabase `service_role` JWT was printed in full by the CLI this session.
  Disable legacy JWT keys in Settings → API Keys; use `sb_publishable_`/`sb_secret_` only.
