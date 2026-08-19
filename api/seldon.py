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


# --------------------------------------------------------------- actions ---
MAX_CLASSES = 100


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
        col_meta.append({
            "name": name,
            "n_missing": len(values) - len(non_null),
            "n_labeled": len(non_null),
            "n_unique": n_unique,
            "task_type": task,
            "predictable": supported,
            "reason": reason,
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

    feature_cols = [c for c in header if c != target]
    if not feature_cols:
        raise ValueError("That file has only one column — there is nothing to predict from.")

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

    preview = []
    for n, row_idx in enumerate(test_idx[:20]):
        preview.append({
            "row": row_idx + 2,
            "prediction": preds[n] if n < len(preds) else None,
            "confidence": round(max(proba[n]), 4) if proba and n < len(proba) else None,
        })

    return {
        "mode": "evaluate" if evaluating else "predict",
        "target": target,
        "taskType": task_type,
        "nContext": len(train_idx),
        "nPredicted": len(test_idx),
        "durationMs": duration_ms,
        "metrics": metrics,
        "preview": preview,
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
