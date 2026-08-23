# Prime Radiant

Upload a table. Pick the column you were missing. Get it filled in.

No training run, no feature engineering, no model to maintain. Prime Radiant is a
thin public front-end over [Seldon](https://www.neuralk.ai), a tabular foundation
model that learns in context: the rows you have already answered become the
examples, and the rows you have not become the output.

It is the working half of [the manifesto](./prediction_manifesto.md).

## How it works

One file goes in. Rows where your target column is **filled** teach the model;
rows where it is **blank** are the ones you get back. If the column has no blanks
at all there is nothing to predict, so we hide a fifth of it and guess it back
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
column mean. Free text and identifiers have no meaningful ordinal encoding
turning 40,000 customer names into 40,000 integers invents an order that isn't
there, so they are **dropped**, and the result says which and why. A column is
dropped when it is empty, averages over 60 characters, has more than 1,000
distinct values, or is distinct on more than half its rows.

### What the API accepts

The deployed `/api/v1/inference` endpoint validates `train.y` as `list[int]`, it
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
| File size | 50 MB |
| Shape | 500,000 rows, 400 columns |
| Rate | 3 predictions per day per visitor |
| Retention | source deleted on completion, predictions after 24 h, abandoned uploads after 1 h |

For reference: 227,845 context rows across 30 columns, a 171 MB request, came back in 46 s.
Seldon is not the binding constraint; the function that parses the file and builds
that request is.

## Explaining a prediction

Every bundled example ships with Shapley values for the rows worth acting on,
precomputed by `scripts/precompute-shap.py` and stored next to the CSV. Only the
actionable label is explained: nobody works through the customers who are
staying, so churn explains the 254 leavers rather than all 2,000 rows, and fraud
explains 10 rather than 8,000. Where that set is still larger than a person can
work through it is capped at the 200 most certain, and the page says so.

Exact enumeration under 13 features, permutation sampling above, because 2^30 is
not a number of coalitions anyone enumerates. Absent features are replaced with
values from real background rows rather than the scaled mean: the mean row is the
centroid, which is not a customer that exists, and explaining from there put the
baseline at 68% on a dataset that churns at 20%. With real backgrounds it lands
at 29%.

It is affordable only because Seldon takes `X_test` as a batch, so every
perturbation of every row goes in one request. All five samples together were
5.8 million synthetic rows in about eight minutes.

Uploads get no explanations. We did the homework for our examples and do not
pretend to have done it for your file.

## Characterising the group

The columns that contributed most, and how each is distributed across the
predicted groups. Shares are within a group rather than across, because the rows
worth acting on are usually the small minority and counts would hide them.

This is the view a comparison of averages cannot give. On churn the two groups
average 1.5 and 1.6 products, which reads as irrelevant, and a difference of
means ranked that column last of six. The distribution shows three products is
0.3% of one group and 21% of the other, a factor of seventy, and Shapley ranks
the same column second. A column whose effect is not monotonic is invisible to
an average and obvious here.

## Reading the predictions

Every run comes back with the input columns beside each prediction, and an
analysis panel underneath: the predicted class mix against the mix in your
labelled rows, a confidence histogram, which columns most separate the predicted
groups, and, when the column was already complete, a confusion matrix.

None of it costs another inference call, which is the point: an answer that
takes seconds shouldn't become an answer that takes a minute to explain itself.
The column comparison is an association, not a cause, and says so.

The confusion matrix is usually the most useful of the four. On the bundled churn
sample the headline is 86% accuracy, and the matrix shows the model catches 140
of 317 actual churners, the same number, read two ways.

## The board

A second page asks two questions, *what do you want to predict* and *what are you
going to do with the predictions*, and lets people vote. No account, no email.
Votes and rate limits are deduped on a salted hash of IP + user-agent; the raw
address is never stored.

## Running it

```bash
npm install
cp .env.example .env.local     # fill in the values
supabase link --project-ref <your-ref>
supabase db push

npm run dev:seldon             # terminal 1, the Python inference function
npm run dev                    # terminal 2, the site
```

On Vercel, `/api/seldon` is served by the platform's filesystem phase before any
Next.js route sees it. Locally there is no such phase: the Next dev server owns
every path, so `vercel dev` returns its own 404 for that route. `npm run dev:seldon`
runs the same handler standalone on port 3999 and `next.config.ts` rewrites to it in
development only.

## Sample data

`public/samples/` holds five public benchmarks so the site is usable without your
own data: bank customer churn, machine failure (UCI AI4I 2020), online shopper
intent, credit score (three classes, shipped as parquet so that path is covered
too) and card fraud. All are reshaped into the one-file form the site expects.

Card fraud is a 40,000-row stratified sample of 284,807, keeping the real 0.17%
fraud rate rather than enriching the positives, because the imbalance is what
makes that benchmark worth showing. The full file is 115 MB, over the upload cap.

`UNLIMITED_KEY` lifts the daily cap for `/predict?mode=<key>`. It never lifts the
global storage guard, and leaving it unset disables the feature.

## Stack

Next.js 16 (App Router, Turbopack) · Supabase (Postgres + Storage) · Vercel ·
Seldon

## License

MIT
