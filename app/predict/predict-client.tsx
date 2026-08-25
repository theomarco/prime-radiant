"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LIMITS_COPY, MAX_FILE_BYTES, isAcceptedFile, isBundledSample } from "@/lib/limits";
import { PredictionAnalysis, type Analysis } from "@/components/analysis";
import { Verdict, type Explain, type RankedGroup } from "@/components/verdict";
import { Faq } from "@/components/faq";

type ColumnMeta = {
  name: string;
  n_missing: number;
  n_labeled: number;
  n_unique: number;
  task_type: string | null;
  predictable: boolean;
  reason: string | null;
  feature: boolean;
  feature_note: string | null;
};

type Result = {
  mode: "predict" | "evaluate";
  target: string;
  taskType: string;
  nContext: number;
  nPredicted: number;
  featuresUsed: number;
  droppedFeatures: { name: string; reason: string }[];
  durationMs: number;
  metrics: Record<string, number | null> | null;
  actionable: string | null;
  ranked: RankedGroup[];
  previewColumns: string[];
  previewTruncated: boolean;
  preview: {
    row: number;
    prediction: unknown;
    confidence: number | null;
    values: (string | number | null)[];
  }[];
  analysis: Analysis;
  downloadUrl: string;
};

type Phase = "idle" | "uploading" | "inspecting" | "choosing" | "predicting" | "done";

const SAMPLES = [
  { file: "bank-churn.csv", industry: "Banking", label: "Bank customers", hint: "Will this one leave?", rows: "10,000 rows" },
  { file: "credit-score.parquet", industry: "Banking", label: "Credit files", hint: "Good, standard or poor?", rows: "99,960 rows" },
  { file: "card-fraud.parquet", industry: "Payments", label: "Card payments", hint: "Which charges are fraud?", rows: "284,807 rows" },
  { file: "online-shoppers.csv", industry: "Retail", label: "Web sessions", hint: "Will this one buy?", rows: "12,330 rows" },
  { file: "machine-failure.csv", industry: "Manufacturing", label: "Machine sensors", hint: "Will this one fail?", rows: "8,000 rows" },
  { file: "lead-scoring.csv", industry: "Education", label: "Sales leads", hint: "Which one converts?", rows: "9,240 rows" },
  { file: "hr-attrition.csv", industry: "Workforce", label: "Employee records", hint: "Who is about to resign?", rows: "1,470 rows" },
  { file: "hotel-cancellations.parquet", industry: "Travel", label: "Hotel bookings", hint: "Will this one cancel?", rows: "119,390 rows" },
  { file: "late-delivery.csv", industry: "Logistics", label: "Parcel shipments", hint: "Will this one arrive late?", rows: "10,999 rows" },
];

const INFERENCE_DOWN =
  "The inference function isn't running. Start it in a second terminal with `npm run dev:seldon`.";

/**
 * Read a JSON response without assuming it is JSON. A failing endpoint can hand
 * back a platform error page, a proxy failure, or nothing at all, and calling
 * .json() on any of those reports a parse error instead of the real cause
 * which makes the actual problem invisible. Parse defensively and say what
 * happened.
 */
async function readJson(res: Response, label: string, inference = false) {
  const text = (await res.text()).trim();

  // In development the inference endpoint is a rewrite to a separate process.
  // If nothing is listening the dev server answers for it, and the reply is
  // never JSON, which is the single most likely reason to land here locally.
  const devFunctionDown =
    inference && process.env.NODE_ENV === "development" && !res.ok;

  if (!text) {
    if (devFunctionDown) throw new Error(INFERENCE_DOWN);
    throw new Error(
      res.ok
        ? `${label} returned an empty response (HTTP ${res.status}).`
        : `${label} failed with HTTP ${res.status} and no message.`,
    );
  }

  let data: { error?: string };
  try {
    data = JSON.parse(text);
  } catch {
    if (devFunctionDown) throw new Error(INFERENCE_DOWN);
    throw new Error(
      `${label} returned HTTP ${res.status} instead of a result. ${text.slice(0, 120)}`,
    );
  }

  if (!res.ok) throw new Error(data.error ?? `${label} failed (HTTP ${res.status}).`);
  return data as never;
}

export function PredictClient() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [filename, setFilename] = useState("");
  const [jobId, setJobId] = useState("");
  const [token, setToken] = useState("");
  const [columns, setColumns] = useState<ColumnMeta[]>([]);
  const [shape, setShape] = useState<{ nRows: number; nCols: number } | null>(null);
  const [target, setTarget] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  // Explanations are prepared offline for the bundled examples, where the
  // expensive thing can be done properly. Uploads get none for now.
  const [explain, setExplain] = useState<Explain | null>(null);
  const [sampleFile, setSampleFile] = useState("");
  const [dragging, setDragging] = useState(false);
  // Some failures are about this file; some are about you, today. Only the
  // first kind is worth offering a retry for.
  const [retryable, setRetryable] = useState(true);
  // Read once from the URL rather than useSearchParams, which would force this
  // statically prerendered page to become dynamic.
  const [mode, setMode] = useState("");
  useEffect(() => {
    setMode(new URLSearchParams(window.location.search).get("mode") ?? "");
  }, []);
  const [unlimited, setUnlimited] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setPhase("idle"); setError(null); setFilename(""); setJobId(""); setToken(""); setRetryable(true);
    setColumns([]); setShape(null); setTarget(""); setResult(null); setExplain(null); setSampleFile("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const start = useCallback(async (file: File | { name: string }) => {
    const blob = file instanceof File ? file : null;
    setError(null); setResult(null); setExplain(null); setRetryable(true); setFilename(file.name);

    if (!isAcceptedFile(file.name)) {
      setError("That needs to be a .csv or .parquet file."); return;
    }
    // Size, rows and the daily count all guard uploads. A bundled sample is
    // never uploaded, so none of them apply to it.
    if (blob && !isBundledSample(blob.name) && blob.size > MAX_FILE_BYTES) {
      setError(`That file is ${(blob.size / 1048576).toFixed(1)} MB. The limit is ${LIMITS_COPY.file}.`);
      return;
    }

    try {
      setPhase("uploading");
      const jobRes = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, size: blob?.size ?? 0, mode }),
      });
      // 429 is the daily limit, 503 is storage being full. Neither is about the
      // file, so do not invite the user to pick a different one.
      if (jobRes.status === 429 || jobRes.status === 503) setRetryable(false);
      const job: {
        jobId: string;
        token: string;
        uploadUrl: string | null;
        unlimited?: boolean;
      } = await readJson(jobRes, "Creating the job");
      if (job.unlimited) setUnlimited(true);

      // No upload URL means the file is a bundled sample and already in place.
      if (job.uploadUrl) {
        const put = await fetch(job.uploadUrl, { method: "PUT", body: blob! });
        if (!put.ok) throw new Error("The upload did not complete. Try again.");
      }
      setJobId(job.jobId);
      setToken(job.token);

      setPhase("inspecting");
      const inspectRes = await fetch("/api/seldon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "inspect", jobId: job.jobId, token: job.token }),
      });
      const meta: { nRows: number; nCols: number; columns: ColumnMeta[] } = await readJson(
        inspectRes,
        "Reading the table",
        true,
      );

      setColumns(meta.columns);
      setShape({ nRows: meta.nRows, nCols: meta.nCols });
      // Default to a column that has blanks to fill. That is usually the point.
      const withBlanks = meta.columns.find((c) => c.predictable && c.n_missing > 0);
      setTarget((withBlanks ?? meta.columns.find((c) => c.predictable))?.name ?? "");
      setPhase("choosing");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setPhase("idle");
    }
  }, []);

  const predict = async () => {
    setError(null); setPhase("predicting");
    try {
      const res = await fetch("/api/seldon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "predict", jobId, token, target }),
      });
      const data: Result = await readJson(res, "The prediction", true);
      setResult(data);
      setPhase("done");
      if (sampleFile) {
        const stem = sampleFile.replace(/\.(csv|parquet|pq)$/i, "");
        fetch(`/samples/${stem}.explain.json`)
          .then((r) => (r.ok ? r.json() : null))
          // Keyed by row number, so a mismatch yields no explanation rather
          // than the wrong one.
          .then((e) => setExplain(e && e.target === data.target ? e : null))
          .catch(() => setExplain(null));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setPhase("choosing");
    }
  };

  const loadSample = async (sample: (typeof SAMPLES)[number]) => {
    setError(null);
    // Move out of the idle state before fetching, not after. Otherwise the whole
    // idle view sits there through the download with no sign anything happened.
    setFilename(sample.file);
    setSampleFile(sample.file);
    setPhase("uploading");
    // The runtime reads the sample from the CDN itself. Pulling 66 MB into the
    // browser only to push it back up was moving the file twice for nothing.
    await start({ name: sample.file });
  };

  const busy = phase === "uploading" || phase === "inspecting" || phase === "predicting";
  const busyLabel =
    phase === "uploading" ? "Uploading" : phase === "inspecting" ? "Reading the table" : "Predicting";

  return (
    <div
      className={`mx-auto space-y-10 ${phase === "done" ? "max-w-6xl" : "max-w-3xl"}`}
    >
      {/* First thing in the flow, not the last: an error under the dropzone and
          the examples is an error you have to go looking for. */}
      {error && (
        <div className="rounded-lg border border-line bg-pale-red px-6 py-4 text-[0.875rem] text-pale-red-ink">
          {error}
          {retryable && phase === "idle" && filename && (
            <button onClick={reset} className="ml-3 underline underline-offset-4">
              Try another file
            </button>
          )}
        </div>
      )}

      {/* ---------------------------------------------------------- dropzone */}
      {phase === "idle" && (
        <>
          <div>
            <p className="eyebrow mb-4">Start with one of these</p>
            <div className="grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
              {SAMPLES.map((s) => (
                <button
                  key={s.file}
                  onClick={() => void loadSample(s)}
                  className="group bg-surface p-6 text-left transition-colors hover:bg-surface-sunk"
                >
                  <span className="inline-flex rounded-full border border-line bg-surface-sunk px-2 py-0.5 font-mono text-[0.5625rem] tracking-[0.1em] text-muted uppercase">
                    {s.industry}
                  </span>
                  <p className="mt-2.5 text-[0.9375rem] text-ink">{s.label}</p>
                  <p className="mt-1 text-[0.8125rem] text-muted">{s.hint}</p>
                  <p className="mt-3 font-mono text-[0.625rem] tracking-wide text-muted uppercase">
                    {s.rows}
                  </p>
                </button>
              ))}
            </div>
            <p className="mt-4 text-[0.8125rem] text-muted">
              Public benchmarks, reshaped into the one-file form above. These run whole and
              without limits: they are already prepared and already here, so nothing is
              uploaded and nothing counts against your daily predictions.
            </p>
          </div>

          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault(); setDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (file) void start(file);
            }}
            className={`rounded-xl border border-dashed p-14 text-center transition-colors ${
              dragging ? "border-ink bg-surface" : "border-line-strong bg-surface/60"
            }`}
          >
            <p className="display text-2xl">Or bring your own</p>
            <p className="mx-auto mt-3 max-w-sm text-[0.9375rem] text-muted">
              One file. Rows where your answer column is filled teach the model; rows where
              it is blank are the ones you get back.
            </p>
            <button
              onClick={() => inputRef.current?.click()}
              className="mt-7 btn-primary rounded-md px-6 py-3 text-[0.9375rem] transition-all"
            >
              Choose a file
            </button>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.parquet,.pq"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void start(f); }}
            />
            <p className="mt-7 font-mono text-[0.6875rem] tracking-wide text-muted uppercase">
              Your file · CSV or Parquet · {LIMITS_COPY.file} · {LIMITS_COPY.rows} ·{" "}
              {unlimited ? (
                <span className="text-accent">no daily limit</span>
              ) : (
                LIMITS_COPY.perDay
              )}
            </p>
          </div>


          <div className="pt-6">
            <Faq />
          </div>
        </>
      )}

      {/* ------------------------------------------------------------- busy */}
      {busy && (
        <div className="rounded-xl border border-line bg-surface p-14 text-center">
          <p className="display text-2xl">{busyLabel}…</p>
          <p className="mt-3 font-mono text-[0.75rem] text-muted">{filename}</p>
          {phase === "predicting" && (
            <p className="mx-auto mt-6 max-w-sm text-[0.9375rem] text-muted">
              No training run is happening. The whole table goes to the model as context,
              and the answer comes back.
            </p>
          )}
        </div>
      )}

      {/* ---------------------------------------------------- column picker */}
      {phase === "choosing" && shape && (
        <div className="rounded-xl border border-line bg-surface">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-8 py-5">
            <p className="text-[0.9375rem] text-ink">Which column is the answer?</p>
            <p className="font-mono text-[0.6875rem] tracking-wide text-muted uppercase">
              {shape.nRows.toLocaleString()} rows · {shape.nCols} columns
            </p>
          </div>
          <div className="max-h-[26rem] overflow-y-auto">
            {columns.map((col) => {
              const active = target === col.name;
              return (
                <button
                  key={col.name}
                  disabled={!col.predictable}
                  onClick={() => setTarget(col.name)}
                  className={`flex w-full items-center justify-between gap-4 border-b border-line px-8 py-4 text-left transition-colors last:border-b-0 ${
                    col.predictable ? "hover:bg-surface-sunk" : "cursor-not-allowed opacity-45"
                  } ${active ? "bg-pale-yellow/50" : ""}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-[0.8125rem] text-ink">
                      {col.name}
                    </span>
                    <span className="mt-0.5 block text-[0.75rem] text-muted">
                      {col.predictable
                        ? `${col.n_unique} distinct · ${col.n_missing.toLocaleString()} blank`
                        : col.reason}
                      {!col.feature && (
                        <span className="text-pale-yellow-ink">
                          {" · ignored as input"}
                          {col.feature_note ? ` (${col.feature_note})` : ""}
                        </span>
                      )}
                    </span>
                  </span>
                  {col.predictable && col.n_missing > 0 && (
                    <span className="shrink-0 rounded-full bg-pale-blue px-2.5 py-0.5 font-mono text-[0.625rem] tracking-wider text-pale-blue-ink uppercase">
                      {col.n_missing.toLocaleString()} to fill
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-line px-8 py-5">
            <button
              onClick={() => void predict()}
              disabled={!target}
              className="btn-primary rounded-md px-6 py-3 text-[0.9375rem] transition-all disabled:opacity-40"
            >
              Predict {target ? `"${target}"` : ""}
            </button>
            <button onClick={reset} className="text-[0.875rem] text-muted hover:text-ink">
              Start over
            </button>
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------- result */}
      {phase === "done" && result && (
        <div className="space-y-10">
          <Verdict
            ranked={result.ranked}
            explain={explain}
            downloadUrl={result.downloadUrl}
            nPredicted={result.nPredicted}
          />

          <p className="max-w-[70ch] text-[0.8125rem] text-muted">
            Learned from {result.nContext.toLocaleString()} rows you had already answered, in{" "}
            {(result.durationMs / 1000).toFixed(1)} seconds. Nothing was trained. Your file was
            deleted the moment this finished and the predictions expire in 24 hours.
          </p>

          <div className="border-t border-line">
            {result.metrics && (
              <details className="border-b border-line">
                <summary className="flex cursor-pointer items-baseline justify-between gap-6 py-5 text-[0.9375rem] text-ink-soft">
                  Your column was already complete, so a fifth was hidden and guessed back
                  <span className="shrink-0 font-mono text-muted">+</span>
                </summary>
                <div className="flex flex-wrap gap-x-10 gap-y-3 pb-6">
                  {Object.entries(result.metrics)
                    .filter(([, v]) => typeof v === "number")
                    .map(([k, v]) => (
                      <div key={k}>
                        <p className="display text-2xl">
                          {k === "accuracy" || k === "f1_macro"
                            ? `${((v as number) * 100).toFixed(1)}%`
                            : (v as number).toFixed(3)}
                        </p>
                        <p className="font-mono text-[0.6875rem] tracking-wide text-muted uppercase">
                          {k.replace("_", " ")}
                        </p>
                      </div>
                    ))}
                </div>
              </details>
            )}

            <details className="border-b border-line">
              <summary className="flex cursor-pointer items-baseline justify-between gap-6 py-5 text-[0.9375rem] text-ink-soft">
                Look closer at how it did
                <span className="shrink-0 font-mono text-muted">+</span>
              </summary>
              <div className="pb-6">
                {result.analysis && (
                  <PredictionAnalysis
                    analysis={result.analysis}
                    target={result.target}
                    importance={explain?.importance}
                    actionable={explain?.actionable ?? result.actionable ?? undefined}
                  />
                )}
              </div>
            </details>

            <details className="border-b border-line">
              <summary className="flex cursor-pointer items-baseline justify-between gap-6 py-5 text-[0.9375rem] text-ink-soft">
                See the columns that went in
                <span className="shrink-0 font-mono text-muted">+</span>
              </summary>
              <div className="pb-6">
                {result.droppedFeatures.length > 0 && (
                  <p className="mb-5 max-w-[66ch] text-[0.875rem] text-muted">
                    Predicted from {result.featuresUsed} column
                    {result.featuresUsed === 1 ? "" : "s"}. Left out because they have no
                    meaningful encoding:{" "}
                    {result.droppedFeatures.map((d) => `${d.name} (${d.reason})`).join(", ")}.
                  </p>
                )}
                <div className="overflow-hidden rounded-xl border border-line bg-surface-raised">
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-left text-[0.8125rem] whitespace-nowrap">
                      <thead>
                        <tr className="border-b border-line font-mono text-[0.6875rem] tracking-wide text-muted uppercase">
                          <th
                            className="sticky left-0 z-20 border-r border-line-strong px-5 py-3 text-left font-normal"
                            style={{ background: "var(--answer-tint)" }}
                          >
                            <span className="flex items-center gap-5">
                              <span className="w-11">Row</span>
                              <span className="w-16 text-ink">{result.target}</span>
                              <span className="w-24">Confidence</span>
                            </span>
                          </th>
                          {result.previewColumns.map((c) => (
                            <th key={c} className="px-4 py-3 text-left font-normal">
                              {c}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="font-mono">
                        {result.preview.map((p) => (
                          <tr key={p.row} className="border-b border-line last:border-b-0">
                            <td
                              className="sticky left-0 z-20 border-r border-line-strong px-5 py-2.5"
                              style={{ background: "var(--answer-tint)" }}
                            >
                              <span className="flex items-center gap-5">
                                <span className="w-11 text-muted">{p.row}</span>
                                <span className="w-16 text-ink">{String(p.prediction)}</span>
                                <span className="w-24 text-muted">
                                  {p.confidence === null
                                    ? "-"
                                    : `${(p.confidence * 100).toFixed(1)}%`}
                                </span>
                              </span>
                            </td>
                            {p.values.map((v, i) => (
                              <td key={result.previewColumns[i]} className="px-4 py-2.5 text-ink-soft">
                                {v === null || v === "" ? (
                                  <span className="text-muted">-</span>
                                ) : (
                                  String(v)
                                )}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </details>
          </div>

          <button onClick={reset} className="text-[0.875rem] text-muted hover:text-ink">
            Predict something else
          </button>
        </div>
      )}

    </div>
  );
}
