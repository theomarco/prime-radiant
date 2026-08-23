#!/usr/bin/env python3
"""Precompute Shapley values for the rows a company would act on.

Only the actionable label is explained, never the whole prediction set: nobody
works through the customers who are staying. Where that set is still larger than
a person can act on, it is capped by confidence and the UI says so.

Exact enumeration under 13 features, permutation sampling above, because 2^30 is
not a number of coalitions anyone is enumerating. Every perturbation for every
row goes into one batched request, which is the only reason this is minutes
rather than days.

    python3 scripts/precompute-shap.py [sample.csv ...]
"""
import importlib.util
import json
import math
import os
import random
import sys
import time
from itertools import combinations
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("seldon", ROOT / "api" / "seldon.py")
S = importlib.util.module_from_spec(spec)
spec.loader.exec_module(S)

# file -> (target column, the label worth acting on)
SAMPLES = {
    "bank-churn.csv": ("Exited", "1"),
    "machine-failure.csv": ("target", "1"),
    "online-shoppers.csv": ("Revenue", "True"),
    "credit-score.parquet": ("Credit_Score", "Poor"),
    "card-fraud.csv": ("Class", "1"),
}

EXACT_MAX_FEATURES = 12
PERMUTATIONS = 64          # for the sampled path
BACKGROUNDS = 8            # real rows, never the scaled mean
CAP = 200                  # a human-sized action list
MAX_BATCH = 60_000         # synthetic rows per request
TOP_PARTS = 8              # contributions kept per row


def load_env():
    f = ROOT / ".env.local"
    if not f.exists():
        return
    for line in f.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def predict(x_train, y_train, x_test):
    """Call in chunks so a single request never gets absurd."""
    proba = []
    for i in range(0, len(x_test), MAX_BATCH):
        body = S.post_inference(x_train, y_train, x_test[i : i + MAX_BATCH], "classification")
        proba.extend(S.extract_proba(body) or [])
    return proba


def exact_shapley(f, m):
    """Weighted marginal contributions over every subset."""
    fact = [math.factorial(k) for k in range(m + 1)]
    phi = [0.0] * m
    for j in range(m):
        total = 0.0
        for mask, value in f.items():
            if mask[j]:
                continue
            with_j = list(mask)
            with_j[j] = 1
            s = sum(mask)
            total += fact[s] * fact[m - s - 1] / fact[m] * (f[tuple(with_j)] - value)
        phi[j] = total
    return phi


def run(filename, target, actionable):
    raw = (ROOT / "public" / "samples" / filename).read_bytes()
    header, columns = S.read_table(raw, filename)
    y = columns[target]
    labelled = [i for i, v in enumerate(y) if not S.is_null_value(v)]
    blank = [i for i, v in enumerate(y) if S.is_null_value(v)]
    feats = [n for n in header if n != target and S.classify_feature(columns[n])[0]]
    m = len(feats)

    tr = S.slice_cols(columns, labelled)
    te = S.slice_cols(columns, blank)
    state = S.fit_preprocessor(tr, feats)
    x_train = S.rows_from_columns(S.apply_preprocessor(tr, state, feats), feats)
    x_test = S.rows_from_columns(S.apply_preprocessor(te, state, feats), feats)
    y_raw = [tr[target][i] for i in range(len(labelled))]
    classes = sorted({v for v in y_raw}, key=lambda v: (str(type(v)), v))
    code = {str(c): i for i, c in enumerate(classes)}
    y_train = [code[str(v)] for v in y_raw]
    if actionable not in code:
        raise SystemExit(f"{filename}: '{actionable}' is not one of {sorted(code)}")
    target_idx = code[actionable]

    body = S.post_inference(x_train, y_train, x_test, "classification")
    proba = S.extract_proba(body)
    preds = S.extract_predictions(body)
    hits = [i for i, p in enumerate(preds) if int(p) == target_idx]
    hits.sort(key=lambda i: -proba[i][target_idx])
    capped = hits[:CAP]

    rng = random.Random(17)
    background = [x_train[i] for i in rng.sample(range(len(x_train)), min(BACKGROUNDS, len(x_train)))]
    exact = m <= EXACT_MAX_FEATURES

    if exact:
        masks = []
        for r in range(m + 1):
            for c in combinations(range(m), r):
                mask = [0] * m
                for j in c:
                    mask[j] = 1
                masks.append(mask)
        per_row = len(masks) * len(background)
    else:
        orders = [rng.sample(range(m), m) for _ in range(PERMUTATIONS)]
        per_row = PERMUTATIONS * (m + 1) * len(background)

    print(f"  {len(hits):,} rows predicted '{actionable}'"
          + (f", explaining the top {len(capped)}" if len(hits) > len(capped) else "")
          + f" | {m} features, {'exact' if exact else f'{PERMUTATIONS} permutations'}"
          + f" | {len(capped) * per_row:,} synthetic rows")

    batch = []
    for i in capped:
        x = x_test[i]
        if exact:
            for mask in masks:
                for b in background:
                    batch.append([x[j] if mask[j] else b[j] for j in range(m)])
        else:
            for order in orders:
                for b in background:
                    row = list(b)
                    batch.append(list(row))          # nothing revealed yet
                    for j in order:
                        row[j] = x[j]
                        batch.append(list(row))      # one more feature revealed

    started = time.time()
    pr = predict(x_train, y_train, batch)
    took = time.time() - started
    print(f"  {len(batch):,} rows in {took:.1f}s")

    out_rows = {}
    cursor = 0
    for i in capped:
        if exact:
            f = {}
            for mask in masks:
                vals = [pr[cursor + q][target_idx] for q in range(len(background))]
                cursor += len(background)
                f[tuple(mask)] = sum(vals) / len(vals)
            phi = exact_shapley(f, m)
            base = f[tuple([0] * m)]
            full = f[tuple([1] * m)]
        else:
            phi = [0.0] * m
            base_acc, full_acc, n_acc = 0.0, 0.0, 0
            for order in orders:
                for _ in background:
                    chain = [pr[cursor + k][target_idx] for k in range(m + 1)]
                    cursor += m + 1
                    for step, j in enumerate(order):
                        phi[j] += chain[step + 1] - chain[step]
                    base_acc += chain[0]
                    full_acc += chain[-1]
                    n_acc += 1
            phi = [v / n_acc for v in phi]
            base, full = base_acc / n_acc, full_acc / n_acc

        parts = sorted(
            ({"col": feats[j], "val": te[feats[j]][i], "phi": round(phi[j], 5)} for j in range(m)),
            key=lambda d: -abs(d["phi"]),
        )
        kept = parts[:TOP_PARTS]
        rest = sum(p["phi"] for p in parts[TOP_PARTS:])
        out_rows[str(blank[i] + 2)] = {
            "p": round(full, 5),
            "base": round(base, 5),
            "parts": kept,
            "rest": round(rest, 5),
        }

    return {
        "target": target,
        "actionable": actionable,
        "exact": exact,
        "explained": len(capped),
        "actionableTotal": len(hits),
        "baseline": round(sum(r["base"] for r in out_rows.values()) / max(len(out_rows), 1), 5),
        "rows": out_rows,
    }


def main():
    load_env()
    if not os.environ.get("NEURALK_API_KEY"):
        raise SystemExit("NEURALK_API_KEY is not set")
    wanted = sys.argv[1:] or list(SAMPLES)
    for filename in wanted:
        target, actionable = SAMPLES[filename]
        print(f"{filename}")
        result = run(filename, target, actionable)
        out = ROOT / "public" / "samples" / (Path(filename).stem + ".explain.json")
        out.write_text(json.dumps(result, separators=(",", ":")))
        print(f"  wrote {out.name} ({out.stat().st_size / 1024:.0f} KB)\n")


if __name__ == "__main__":
    main()
