"""Seldon inference endpoint for Prime Radiant.

Two actions over one function so there is no shared-module problem on Vercel:

  inspect  download the uploaded table, validate its shape, return column
           metadata so the browser can render a target picker.
  predict  split on the target column, preprocess, call Seldon, write a
           predictions CSV back to Storage, drop the source file.

If the target column has empty cells we predict those rows. If it is fully
labelled there is nothing to predict, so we hold out 20% and report metrics
instead -- that turns "prove it works" into a first-visit action.

Preprocessing mirrors skrub TableVectorizer(cardinality_threshold=0) and is
ported verbatim from the canonical seldon skill client so results match:
ordinal-encode categoricals, standard-scale everything, impute nulls with the
column mean (0 after centering).
"""

import csv
import hmac
import io
import json
import math
import os
import random
import time
import uuid
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler

ENDPOINT = os.environ.get("SELDON_ENDPOINT", "https://api.prediction.neuralk.ai/api/v1/inference")
MODEL = os.environ.get("SELDON_MODEL", "seldon-small")
PREDICTION_KEYS = ("predictions", "y_pred", "yhat", "y", "preds")
PROBA_KEYS = ("probabilities", "proba", "y_proba", "probas")
NULL_TOKENS = {"", "nan", "null", "none", "na", "n/a"}

MAX_ROWS = 200_000
MAX_COLS = 200
BUCKET = "uploads"
HOLDOUT_FRAC = 0.2
SEED = 42


# --------------------------------------------------------------- helpers ---
def is_null_str(v):
    return v is None or v.strip().lower() in NULL_TOKENS


def is_null_value(v):
    if v is None:
        return True
    if isinstance(v, float) and math.isnan(v):
        return True
    return False


def coerce_column(values):
    """Infer int/float/str for a whole column, pandas-style."""
    non_null = [v for v in values if not is_null_str(v)]
    if non_null and all(v.lstrip("-").isdigit() for v in non_null):
        return [None if is_null_str(v) else int(v) for v in values]
    try:
        [float(v) for v in non_null]
    except ValueError:
        return [None if is_null_str(v) else v for v in values]
    return [None if is_null_str(v) else float(v) for v in values]


def read_csv_bytes(raw):
    text = raw.decode("utf-8-sig", errors="replace")
    rows = list(csv.reader(io.StringIO(text)))
    if not rows:
        return [], {}
    header = [h.strip() for h in rows[0]]
    staged = {h: [] for h in header}
    for r in rows[1:]:
        for i, h in enumerate(header):
            staged[h].append(r[i] if i < len(r) else "")
    return header, {h: coerce_column(staged[h]) for h in header}


def read_parquet_bytes(raw):
    import pyarrow.parquet as pq  # imported lazily so the CSV path stays stdlib-only

    table = pq.read_table(io.BytesIO(raw))
    header = list(table.column_names)
    columns = {}
    for name in header:
        out = []
        for v in table.column(name).to_pylist():
            if v is None or (isinstance(v, float) and math.isnan(v)):
                out.append(None)
            elif isinstance(v, bool):
                out.append(str(v))
            elif isinstance(v, (int, float, str)):
                out.append(v)
            else:
                out.append(str(v))
        columns[name] = out
    return header, columns


def read_table(raw, filename):
    if filename.lower().endswith((".parquet", ".pq")):
        return read_parquet_bytes(raw)
    return read_csv_bytes(raw)


# --------------------------------------------------------- preprocessing ---
def fit_preprocessor(train_columns, feature_cols):
    state = {}
    for col in feature_cols:
        values = train_columns[col]
        non_null = [v for v in values if not is_null_value(v)]
        if not non_null:
            state[col] = None
            continue
        if any(isinstance(v, str) for v in non_null):
            uniques = sorted({str(v) for v in non_null})
            mapping = {u: i for i, u in enumerate(uniques)}
            encoded = [mapping[str(v)] for v in non_null]
        else:
            mapping = None
            encoded = [float(v) for v in non_null]
        mean = sum(encoded) / len(encoded)
        var = sum((x - mean) ** 2 for x in encoded) / len(encoded)
        state[col] = {"mapping": mapping, "mean": mean, "std": math.sqrt(var) if var > 0 else 1.0}
    return state


def apply_preprocessor(columns, state, feature_cols):
    out = {}
    for col in feature_cols:
        s = state.get(col)
        values = columns[col]
        if s is None:
            out[col] = [0.0] * len(values)
            continue
        mapping, mean, std = s["mapping"], s["mean"], s["std"]
        unknown_idx = len(mapping) if mapping else None
        result = []
        for v in values:
            if is_null_value(v):
                result.append(0.0)
            elif mapping is not None:
                result.append((mapping.get(str(v), unknown_idx) - mean) / std)
            else:
                try:
                    result.append((float(v) - mean) / std)
                except (TypeError, ValueError):
                    result.append(0.0)
        out[col] = result
    return out


def rows_from_columns(columns, cols):
    if not cols:
        return []
    n = len(columns[cols[0]])
    return [[columns[c][i] for c in cols] for i in range(n)]


def slice_cols(columns, indices):
    return {c: [columns[c][i] for i in indices] for c in columns}


def infer_task_type(y):
    non_null = [v for v in y if not is_null_value(v)]
    if not non_null:
        return "regression"
    if all(isinstance(v, bool) for v in non_null):
        return "classification"
    if all(isinstance(v, str) for v in non_null):
        return "classification"
    if all(isinstance(v, int) and not isinstance(v, bool) for v in non_null):
        return "classification"
    try:
        nums = [float(v) for v in non_null]
    except (TypeError, ValueError):
        return "classification"
    uniq = set(nums)
    if len(uniq) <= 20 and all(n.is_integer() for n in nums):
        return "classification"
    return "regression"


# --------------------------------------------------------------- metrics ---
def accuracy(y_true, y_pred):
    if not y_true:
        return None
    return sum(1 for a, b in zip(y_true, y_pred) if str(a) == str(b)) / len(y_true)


def f1_macro(y_true, y_pred):
    labels = sorted({str(v) for v in y_true} | {str(v) for v in y_pred})
    if not labels:
        return None
    scores = []
    for lab in labels:
        tp = sum(1 for a, b in zip(y_true, y_pred) if str(a) == lab and str(b) == lab)
        fp = sum(1 for a, b in zip(y_true, y_pred) if str(a) != lab and str(b) == lab)
        fn = sum(1 for a, b in zip(y_true, y_pred) if str(a) == lab and str(b) != lab)
        prec = tp / (tp + fp) if tp + fp else 0.0
        rec = tp / (tp + fn) if tp + fn else 0.0
        scores.append(2 * prec * rec / (prec + rec) if prec + rec else 0.0)
    return sum(scores) / len(scores)


def regression_metrics(y_true, y_pred):
    try:
        yt = [float(v) for v in y_true]
        yp = [float(v) for v in y_pred]
    except (TypeError, ValueError):
        return {}
    n = len(yt)
    if not n:
        return {}
    mse = sum((a - b) ** 2 for a, b in zip(yt, yp)) / n
    mae = sum(abs(a - b) for a, b in zip(yt, yp)) / n
    mean = sum(yt) / n
    ss_tot = sum((a - mean) ** 2 for a in yt)
    ss_res = sum((a - b) ** 2 for a, b in zip(yt, yp))
    return {
        "rmse": math.sqrt(mse),
        "mae": mae,
        "r2": (1 - ss_res / ss_tot) if ss_tot > 0 else None,
    }


def extract_predictions(body):
    if isinstance(body, list):
        return body
    if isinstance(body, dict):
        for key in PREDICTION_KEYS:
            if key in body:
                return body[key]
    return None


def extract_proba(body):
    if isinstance(body, dict):
        for key in PROBA_KEYS:
            val = body.get(key)
            if isinstance(val, list) and val and isinstance(val[0], (list, tuple)):
                return val
    return None


# -------------------------------------------------------------- supabase ---
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SECRET_KEY", "")


def _sb_request(method, path, data=None, headers=None, timeout=60):
    req = urllib.request.Request(f"{SUPABASE_URL}{path}", data=data, method=method)
    req.add_header("apikey", SUPABASE_KEY)
    req.add_header("Authorization", f"Bearer {SUPABASE_KEY}")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def storage_download(path):
    # Deleted objects keep being served from the CDN on the plain object path, so
    # bust the cache on every read — otherwise a job could be re-run against a
    # file we already promised the user we had thrown away.
    nonce = uuid.uuid4().hex
    return _sb_request("GET", f"/storage/v1/object/{BUCKET}/{path}?t={nonce}", timeout=120)


def storage_upload(path, payload, content_type="text/csv"):
    _sb_request(
        "POST",
        f"/storage/v1/object/{BUCKET}/{path}",
        data=payload,
        headers={"Content-Type": content_type, "x-upsert": "true"},
        timeout=120,
    )


def storage_delete(path):
    try:
        _sb_request("DELETE", f"/storage/v1/object/{BUCKET}/{path}")
    except urllib.error.HTTPError:
        pass  # already gone; nothing to reclaim


def storage_signed_url(path, expires_in=86400):
    body = _sb_request(
        "POST",
        f"/storage/v1/object/sign/{BUCKET}/{path}",
        data=json.dumps({"expiresIn": expires_in}).encode(),
        headers={"Content-Type": "application/json"},
    )
    return f"{SUPABASE_URL}/storage/v1{json.loads(body)['signedURL']}"


def job_get(job_id):
    body = _sb_request("GET", f"/rest/v1/jobs?id=eq.{job_id}&select=*")
    rows = json.loads(body)
    return rows[0] if rows else None


def job_update(job_id, patch):
    _sb_request(
        "PATCH",
        f"/rest/v1/jobs?id=eq.{job_id}",
        data=json.dumps(patch).encode(),
        headers={"Content-Type": "application/json", "Prefer": "return=minimal"},
    )


# ------------------------------------------------------------- inference ---
def post_inference(x_train, y_train, x_test, task_type):
    payload = {"model": MODEL, "train": {"X": x_train, "y": y_train}, "X_test": x_test}
    if task_type == "classification":
        payload["return_proba"] = True
    req = urllib.request.Request(
        ENDPOINT,
        data=json.dumps(payload).encode(),
        headers={
            "Authorization": f"Bearer {os.environ['NEURALK_API_KEY']}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=280) as r:
        return json.loads(r.read())


# -------------------------------------------------------------- analysis ---
CONFIDENCE_BANDS = ((0.0, 0.6), (0.6, 0.7), (0.7, 0.8), (0.8, 0.9), (0.9, 1.01))
REVIEW_THRESHOLD = 0.6


def _counts_as_shares(values):
    total = len(values) or 1
    tally = {}
    for v in values:
        tally[str(v)] = tally.get(str(v), 0) + 1
    return [
        {"label": k, "count": n, "share": n / total}
        for k, n in sorted(tally.items(), key=lambda kv: -kv[1])
    ]


def _numeric_separation(a_values, b_values):
    """Standardised difference of means between two groups, or None."""
    a = [float(v) for v in a_values if not is_null_value(v) and not isinstance(v, str)]
    b = [float(v) for v in b_values if not is_null_value(v) and not isinstance(v, str)]
    if len(a) < 2 or len(b) < 2:
        return None
    ma, mb = sum(a) / len(a), sum(b) / len(b)
    va = sum((x - ma) ** 2 for x in a) / len(a)
    vb = sum((x - mb) ** 2 for x in b) / len(b)
    pooled = math.sqrt((va + vb) / 2)
    if pooled == 0:
        return None
    return {"separation": abs(ma - mb) / pooled, "group_a_mean": ma, "group_b_mean": mb}


def _categorical_separation(a_values, b_values):
    """Largest share gap for any single value between the two groups."""
    a = [str(v) for v in a_values if not is_null_value(v)]
    b = [str(v) for v in b_values if not is_null_value(v)]
    if not a or not b:
        return None
    best = None
    for value in set(a) | set(b):
        share_a = a.count(value) / len(a)
        share_b = b.count(value) / len(b)
        gap = abs(share_a - share_b)
        if best is None or gap > best["separation"]:
            best = {"separation": gap, "value": value, "group_a_share": share_a, "group_b_share": share_b}
    return best


def build_analysis(columns, feature_cols, target, train_idx, test_idx, preds, proba, y_all, evaluating):
    """Everything we can say about these predictions without another API call.

    Deliberately no extra inference: the point of the product is that an answer
    costs seconds, and spending ten more round trips on permutation importance
    would trade that away. What is here is descriptive — how the predictions are
    distributed, how confident they are, which rows to look at by hand, and how
    the input columns differ between the predicted groups. That last one is an
    association, not a cause, and is labelled as such in the UI.
    """
    analysis = {}

    # 1. Predicted mix against the mix in the rows that taught the model. A big
    #    gap here is the fastest way to notice something is wrong.
    analysis["predictedMix"] = _counts_as_shares([str(p) for p in preds])
    analysis["baseMix"] = _counts_as_shares([str(y_all[i]) for i in train_idx])

    # 2. How sure the model is, and which rows a human should check first.
    if proba:
        confidences = [max(row) for row in proba[: len(test_idx)]]
        analysis["confidenceBands"] = [
            {
                "from": lo,
                "to": min(hi, 1.0),
                "count": sum(1 for c in confidences if lo <= c < hi),
            }
            for lo, hi in CONFIDENCE_BANDS
        ]
        ordered = sorted(confidences)
        mid = len(ordered) // 2
        analysis["medianConfidence"] = (
            ordered[mid] if len(ordered) % 2 else (ordered[mid - 1] + ordered[mid]) / 2
        ) if ordered else None
        low = [
            {
                "row": test_idx[n] + 2,
                "prediction": preds[n] if n < len(preds) else None,
                "confidence": round(c, 4),
            }
            for n, c in enumerate(confidences)
            if c < REVIEW_THRESHOLD
        ]
        low.sort(key=lambda r: r["confidence"])
        analysis["needsReview"] = {"count": len(low), "threshold": REVIEW_THRESHOLD, "rows": low[:10]}

    # 3. How the input columns differ between the two largest predicted groups.
    groups = [g["label"] for g in analysis["predictedMix"][:2]]
    if len(groups) == 2:
        a_rows = [test_idx[n] for n, p in enumerate(preds) if str(p) == groups[0] and n < len(test_idx)]
        b_rows = [test_idx[n] for n, p in enumerate(preds) if str(p) == groups[1] and n < len(test_idx)]
        drivers = []
        for col in feature_cols:
            a_values = [columns[col][i] for i in a_rows]
            b_values = [columns[col][i] for i in b_rows]
            non_null = [v for v in a_values + b_values if not is_null_value(v)]
            if not non_null:
                continue
            if any(isinstance(v, str) for v in non_null):
                found = _categorical_separation(a_values, b_values)
                kind = "categorical"
            else:
                found = _numeric_separation(a_values, b_values)
                kind = "numeric"
            if found:
                drivers.append({"name": col, "kind": kind, **found})
        drivers.sort(key=lambda d: -d["separation"])
        analysis["groups"] = {"a": groups[0], "b": groups[1], "aCount": len(a_rows), "bCount": len(b_rows)}
        analysis["drivers"] = drivers[:8]

    # 4. With ground truth in hand, show exactly where it was wrong.
    if evaluating:
        truth = [str(y_all[i]) for i in test_idx]
        labels = sorted(set(truth) | {str(p) for p in preds})
        analysis["confusion"] = {
            "labels": labels,
            "matrix": [
                [sum(1 for t, p in zip(truth, preds) if t == actual and str(p) == predicted)
                 for predicted in labels]
                for actual in labels
            ],
        }

    return analysis


# --------------------------------------------------------------- actions ---
MAX_CLASSES = 100


MAX_FEATURE_CARDINALITY = 1000
FREE_TEXT_MEAN_LENGTH = 60


def classify_feature(values):
    """Decide whether a column can serve as a feature.

    Seldon takes numbers. Numeric columns pass through and categoricals are
    ordinal-encoded, but free text and identifiers have no meaningful ordinal
    encoding — turning 40,000 distinct customer names into 40,000 integers
    invents an ordering that isn't there and dilutes the columns that do carry
    signal. Those get dropped, and the user is told which and why.
    """
    non_null = [v for v in values if not is_null_value(v)]
    if not non_null:
        return False, "column is empty"

    strings = [v for v in non_null if isinstance(v, str)]
    if not strings:
        return True, None

    n_unique = len({str(v) for v in non_null})
    mean_length = sum(len(v) for v in strings) / len(strings)
    if mean_length > FREE_TEXT_MEAN_LENGTH:
        return False, "free text"
    if n_unique > MAX_FEATURE_CARDINALITY:
        return False, f"{n_unique} distinct values"
    if n_unique > 50 and n_unique > len(non_null) * 0.5:
        return False, "looks like an identifier"
    return True, None


def target_supported(n_labeled, n_unique, task_type):
    """Whether Seldon can take this column as a target.

    The deployed /inference endpoint validates `train.y` as list[int]: it takes
    integer-coded class labels only. Categorical labels we can encode, but a
    continuous target has no honest encoding, so we decline it rather than
    silently turning a regression into a bucket-guessing game.
    """
    if n_labeled < 10:
        return False, "needs at least 10 filled rows to learn from"
    if task_type == "regression":
        return False, "continuous values — Seldon's API takes categories, not numbers to estimate"
    if n_unique < 2:
        return False, "every row has the same value — nothing to tell apart"
    if n_unique > MAX_CLASSES:
        return False, f"{n_unique} distinct values — too many categories to predict"
    if n_unique > n_labeled / 2:
        return False, "nearly every row is its own category — this looks like an identifier"
    return True, None


def action_inspect(job):
    raw = storage_download(job["storage_path"])
    header, columns = read_table(raw, job["filename"])

    if not header:
        raise ValueError("That file has no readable header row.")
    if len(header) > MAX_COLS:
        raise ValueError(f"{len(header)} columns — the limit is {MAX_COLS}.")
    n_rows = len(columns[header[0]]) if header else 0
    if n_rows == 0:
        raise ValueError("That file has a header but no data rows.")
    if n_rows > MAX_ROWS:
        raise ValueError(f"{n_rows:,} rows — the limit is {MAX_ROWS:,}.")

    col_meta = []
    for name in header:
        values = columns[name]
        non_null = [v for v in values if not is_null_value(v)]
        n_unique = len({str(v) for v in non_null})
        task = infer_task_type(non_null) if non_null else None
        supported, reason = target_supported(len(non_null), n_unique, task)
        usable, note = classify_feature(values)
        col_meta.append({
            "name": name,
            "n_missing": len(values) - len(non_null),
            "n_labeled": len(non_null),
            "n_unique": n_unique,
            "task_type": task,
            "predictable": supported,
            "reason": reason,
            "feature": usable,
            "feature_note": note,
        })

    job_update(job["id"], {
        "status": "inspected",
        "n_rows": n_rows,
        "n_cols": len(header),
        "col_meta": col_meta,
    })
    return {"nRows": n_rows, "nCols": len(header), "columns": col_meta}


def action_predict(job, target):
    started = time.time()
    raw = storage_download(job["storage_path"])
    header, columns = read_table(raw, job["filename"])

    if target not in columns:
        raise ValueError(f"Column '{target}' is not in that file.")

    y_all = columns[target]
    labeled = [i for i, v in enumerate(y_all) if not is_null_value(v)]
    unlabeled = [i for i, v in enumerate(y_all) if is_null_value(v)]
    if len(labeled) < 10:
        raise ValueError(f"'{target}' has only {len(labeled)} filled rows. Seldon needs at least 10 to learn from.")

    feature_cols, dropped = [], []
    for name in header:
        if name == target:
            continue
        usable, note = classify_feature(columns[name])
        (feature_cols if usable else dropped).append(name if usable else {"name": name, "reason": note})
    if not feature_cols:
        raise ValueError(
            "None of the other columns can be used to predict from — they are all empty, "
            "free text, or identifiers."
        )

    labeled_values = [y_all[i] for i in labeled]
    task_type = infer_task_type(labeled_values)
    n_unique = len({str(v) for v in labeled_values})
    supported, reason = target_supported(len(labeled), n_unique, task_type)
    if not supported:
        raise ValueError(f"'{target}' can't be predicted: {reason}.")

    # Fully-labelled column: nothing to predict, so hold out 20% and score it.
    evaluating = not unlabeled
    if evaluating:
        rnd = random.Random(SEED)
        shuffled = labeled[:]
        rnd.shuffle(shuffled)
        cut = max(1, int(len(shuffled) * HOLDOUT_FRAC))
        test_idx, train_idx = shuffled[:cut], shuffled[cut:]
    else:
        train_idx, test_idx = labeled, unlabeled

    train_cols = slice_cols(columns, train_idx)
    test_cols = slice_cols(columns, test_idx)

    # No context subsampling, ever: accuracy comes from the context rows.
    state = fit_preprocessor(train_cols, feature_cols)
    x_train = rows_from_columns(apply_preprocessor(train_cols, state, feature_cols), feature_cols)
    x_test = rows_from_columns(apply_preprocessor(test_cols, state, feature_cols), feature_cols)
    # The endpoint takes integer class codes, so encode on the way in and
    # decode on the way out. Probability columns follow this same class order.
    y_raw = [train_cols[target][i] for i in range(len(train_idx))]
    classes = sorted({v for v in y_raw}, key=lambda v: (str(type(v)), v))
    code_of = {str(c): i for i, c in enumerate(classes)}
    y_train = [code_of[str(v)] for v in y_raw]

    body = post_inference(x_train, y_train, x_test, task_type)
    raw_preds = extract_predictions(body)
    if raw_preds is None:
        raise ValueError("Seldon returned a response without predictions.")
    proba = extract_proba(body)

    def decode(code):
        try:
            i = int(code)
        except (TypeError, ValueError):
            return code
        return classes[i] if 0 <= i < len(classes) else code

    preds = [decode(p) for p in raw_preds]

    metrics = None
    if evaluating:
        y_true = [y_all[i] for i in test_idx]
        metrics = {"accuracy": accuracy(y_true, preds), "f1_macro": f1_macro(y_true, preds)}

    # Result CSV: the original row, the prediction, and confidence where we have it.
    out = io.StringIO()
    writer = csv.writer(out)
    confidence_col = ["confidence"] if proba else []
    writer.writerow(["row"] + feature_cols + [f"{target}__predicted"] + confidence_col)
    for n, row_idx in enumerate(test_idx):
        conf = [round(max(proba[n]), 6)] if proba and n < len(proba) else ([""] if proba else [])
        writer.writerow(
            [row_idx + 2]  # +2 => 1-based row number in the original file, past the header
            + [columns[c][row_idx] if not is_null_value(columns[c][row_idx]) else "" for c in feature_cols]
            + [preds[n] if n < len(preds) else ""]
            + conf
        )
    payload = out.getvalue().encode()

    result_path = f"{job['id']}/predictions.csv"
    storage_upload(result_path, payload)
    storage_delete(job["storage_path"])  # source is dead weight once predicted

    duration_ms = int((time.time() - started) * 1000)
    job_update(job["id"], {
        "status": "done",
        "target": target,
        "task_type": task_type,
        "n_context": len(train_idx),
        "n_predicted": len(test_idx),
        "result_path": result_path,
        "result_bytes": len(payload),
        "size_bytes": 0,
        "duration_ms": duration_ms,
    })

    # The preview carries the input values too — a prediction with no row beside
    # it is unreadable. Column count is capped so the payload stays small; the
    # full table is in the download.
    preview_cols = feature_cols[:40]
    preview = []
    for n, row_idx in enumerate(test_idx[:25]):
        preview.append({
            "row": row_idx + 2,
            "prediction": preds[n] if n < len(preds) else None,
            "confidence": round(max(proba[n]), 4) if proba and n < len(proba) else None,
            "values": [
                None if is_null_value(columns[c][row_idx]) else columns[c][row_idx]
                for c in preview_cols
            ],
        })

    analysis = build_analysis(
        columns, feature_cols, target, train_idx, test_idx, preds, proba, y_all, evaluating
    )

    return {
        "mode": "evaluate" if evaluating else "predict",
        "target": target,
        "featuresUsed": len(feature_cols),
        "droppedFeatures": dropped,
        "taskType": task_type,
        "nContext": len(train_idx),
        "nPredicted": len(test_idx),
        "durationMs": duration_ms,
        "metrics": metrics,
        "previewColumns": preview_cols,
        "previewTruncated": len(feature_cols) > len(preview_cols),
        "preview": preview,
        "analysis": analysis,
        "downloadUrl": storage_signed_url(result_path),
    }


# --------------------------------------------------------------- handler ---
class handler(BaseHTTPRequestHandler):
    def _reply(self, status, payload):
        encoded = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_POST(self):
        job_id = None
        try:
            length = int(self.headers.get("content-length") or 0)
            body = json.loads(self.rfile.read(length) or b"{}")
            action = body.get("action")
            job_id = body.get("jobId")
            if action not in ("inspect", "predict"):
                return self._reply(400, {"error": "action must be 'inspect' or 'predict'."})
            if not job_id:
                return self._reply(400, {"error": "Missing jobId."})

            job = job_get(job_id)
            if not job:
                return self._reply(404, {"error": "Job not found."})
            token = body.get("token") or ""
            if not hmac.compare_digest(str(job.get("access_token") or ""), str(token)):
                return self._reply(403, {"error": "That job belongs to someone else."})
            if job.get("cleaned_at"):
                return self._reply(410, {"error": "This job's files have expired."})

            if action == "inspect":
                return self._reply(200, action_inspect(job))

            if job["status"] == "running":
                return self._reply(409, {"error": "That prediction is already running."})
            if job["status"] in ("done", "error"):
                return self._reply(409, {"error": "That prediction already ran. Upload the file again to redo it."})
            target = body.get("target")
            if not target:
                return self._reply(400, {"error": "Missing target column."})
            job_update(job_id, {"status": "running"})
            return self._reply(200, action_predict(job, target))

        except urllib.error.HTTPError as exc:
            detail = exc.read().decode(errors="replace")[:400]
            message = f"Upstream error ({exc.code}). {detail}" if detail else f"Upstream error ({exc.code})."
            if job_id:
                job_update(job_id, {"status": "error", "error": message[:800]})
            self._reply(502, {"error": message})
        except Exception as exc:  # noqa: BLE001 - surface the reason to the user
            message = str(exc) or exc.__class__.__name__
            if job_id:
                job_update(job_id, {"status": "error", "error": message[:800]})
            self._reply(400, {"error": message})

    def log_message(self, *args):
        pass
