# Prime Radiant

Upload a table. Pick the column you were missing. Get it filled in.

No training run, no feature engineering, no model to maintain. Prime Radiant is a
thin public front-end over [Seldon](https://www.neuralk.ai), a tabular foundation
model that learns in context: the rows you have already answered become the
examples, and the rows you have not become the output.

It is the working half of [the manifesto](./prediction_manifesto_v5.md).

## How it works

One file goes in. Rows where your target column is **filled** teach the model;
rows where it is **blank** are the ones you get back. If the column has no blanks
at all there is nothing to predict, so we hide a fifth of it and guess it back —
that turns "prove it works" into something you can do on your first visit.

```
browser ──► /api/jobs (TS)      rate check, create job, sign an upload URL
        ──► Supabase Storage    the file goes direct; it never touches a function
        ──► /api/seldon (PY)    inspect: validate shape, return column metadata
        ──► /api/seldon (PY)    predict: preprocess, call Seldon, write results
```

The uploaded file is deleted the moment inference finishes. Predictions expire
after 24 hours.

### Why the inference function is Python

Seldon expects inputs preprocessed the way `skrub TableVectorizer(cardinality_threshold=0)`
would: ordinal-encode categoricals, standard-scale everything, impute nulls with
the column mean. That logic is ported verbatim from Neuralk's own client so results
match; re-implementing it in TypeScript would risk silent accuracy drift. Parquet
support needs `pyarrow` regardless.

### What goes in

Seldon reads numbers. Numeric columns pass through, categorical columns are
ordinal-encoded, and everything is standard-scaled with nulls imputed to the
column mean. Free text and identifiers have no meaningful ordinal encoding —
turning 40,000 customer names into 40,000 integers invents an order that isn't
there — so they are **dropped**, and the result says which and why. A column is
dropped when it is empty, averages over 60 characters, has more than 1,000
distinct values, or is distinct on more than half its rows.

### What the API accepts

The deployed `/api/v1/inference` endpoint validates `train.y` as `list[int]` — it
takes **integer class codes only**. So:

- **Categorical targets** (`Yes`/`No`, `churned`/`retained`) are label-encoded on
  the way in and decoded on the way out. These work.
- **Continuous targets** (price, revenue, temperature) have no honest encoding, so
  they are declined with an explanation rather than silently binned into buckets.

Column eligibility is computed during `inspect`, so the picker greys out what
cannot work and says why, instead of failing after you commit.

## Limits

| | |
|---|---|
| File size | 10 MB |
| Shape | 200,000 rows, 200 columns |
| Rate | 3 predictions per day per visitor |
| Retention | source deleted on completion, predictions after 24 h |

For reference: 8,000 context rows and 2,000 predictions round-trip in about 1.5 s.

## The board

A second page asks two questions — *what do you want to predict* and *what are you
going to do with the predictions* — and lets people vote. No account, no email.
Votes and rate limits are deduped on a salted hash of IP + user-agent; the raw
address is never stored.

## Running it

```bash
npm install
cp .env.example .env.local     # fill in the values
supabase link --project-ref <your-ref>
supabase db push

npm run dev:seldon             # terminal 1 — the Python inference function
npm run dev                    # terminal 2 — the site
```

On Vercel, `/api/seldon` is served by the platform's filesystem phase before any
Next.js route sees it. Locally there is no such phase: the Next dev server owns
every path, so `vercel dev` returns its own 404 for that route. `npm run dev:seldon`
runs the same handler standalone on port 3999 and `next.config.ts` rewrites to it in
development only.

## Sample data

`public/samples/` holds two public benchmark tables so the site is usable without
your own data: bank customer churn and machine failure (UCI AI4I 2020). Both are
reshaped into the one-file form the site expects.

## Stack

Next.js 16 (App Router, Turbopack) · Supabase (Postgres + Storage) · Vercel ·
Seldon

## License

MIT
