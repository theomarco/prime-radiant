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

## Review — 2026-08-19

All tasks above are done except the production deploy, which the permission
classifier blocks (outward-facing publish). Everything else is verified.

**22/22 end-to-end tests pass** against a live Supabase and the real Seldon API:
board post/list/vote/unvote, oversize + wrong-extension rejection, signed direct
upload, capability-token auth (including a forged token), inspect, predict,
re-run refusal, rate limit, and cron auth. Measured accuracy against sealed
Kaggle holdouts: machine failure 98.31% (1,600 rows), bank churn 86.85% (2,000
rows), both round-tripping in about 1.5-2.6 s.

### What changed during the build, and why

1. **The inference API takes `list[int]` only.** Probed it directly: floats and
   strings are both rejected by `train.y` validation. So categorical targets are
   label-encoded and decoded around the call, and continuous targets are declined
   with a reason. Column eligibility is computed during inspect so the picker
   explains this before the user commits. This contradicts the seldon skill's own
   docs, which claim regression support — worth raising with the API team.

2. **Dropped cross-runtime identity derivation.** The first design had the Python
   function recompute the visitor's IP+UA hash to authorise a job. It broke the
   moment a proxy sat in the path, which is the point: agreement on
   `x-forwarded-for` between two separate runtimes was never a sound basis for an
   authorisation check. Jobs now carry a random `access_token`, minted once where
   identity is actually known.

3. **Deleted storage objects keep being served from CDN cache.** A finished job
   could be re-run against a file we had already told the user we deleted. Every
   read is now cache-busted, and finished jobs refuse to re-run.

4. **Abandoned uploads leaked storage.** A file uploaded but never predicted stayed
   forever, which is the entire storage budget. Added a daily cron that
   sweeps anything over 24 h and marks it cleaned.

5. **`vercel dev` cannot serve the Python function** in a Next.js project — the dev
   server owns every route. Added `npm run dev:seldon` plus a development-only
   rewrite so local dev actually works. Confirmed via `vercel build` that the
   function *is* produced for production (`python3.12`, maxDuration 300) and that
   the filesystem phase serves it before the catch-all 404.

### Open

- Preview-scope env vars fail on Vercel CLI 54.4.1 despite following its own
  printed command. Upgrade the CLI, or add them in the dashboard, before relying
  on PR previews.
- Swap `SUPABASE_SECRET_KEY` to the `sb_secret_` value from the dashboard and
  disable the legacy JWT keys. The CLI masks the new-format secret, so the legacy
  service_role JWT is in use as a stopgap.
