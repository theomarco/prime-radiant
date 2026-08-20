"use client";

import { useCallback, useRef, useState } from "react";
import { LIMITS_COPY, MAX_FILE_BYTES, isAcceptedFile } from "@/lib/limits";
import { PredictionAnalysis, type Analysis } from "@/components/analysis";
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
  { file: "bank-churn.csv", label: "Bank customers", hint: "Will this customer leave?", target: "Exited" },
  { file: "machine-failure.csv", label: "Machine sensors", hint: "Will this machine fail?", target: "target" },
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
  const [dragging, setDragging] = useState(false);
  // Some failures are about this file; some are about you, today. Only the
  // first kind is worth offering a retry for.
  const [retryable, setRetryable] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setPhase("idle"); setError(null); setFilename(""); setJobId(""); setToken(""); setRetryable(true);
    setColumns([]); setShape(null); setTarget(""); setResult(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const start = useCallback(async (file: File) => {
    setError(null); setResult(null); setRetryable(true); setFilename(file.name);

    if (!isAcceptedFile(file.name)) {
      setError("That needs to be a .csv or .parquet file."); return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError(`That file is ${(file.size / 1048576).toFixed(1)} MB. The limit is ${LIMITS_COPY.file}.`);
      return;
    }

    try {
      setPhase("uploading");
      const jobRes = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, size: file.size }),
      });
      // 429 is the daily limit, 503 is storage being full. Neither is about the
      // file, so do not invite the user to pick a different one.
      if (jobRes.status === 429 || jobRes.status === 503) setRetryable(false);
      const job: { jobId: string; token: string; uploadUrl: string } = await readJson(
        jobRes,
        "Creating the job",
      );

      const put = await fetch(job.uploadUrl, { method: "PUT", body: file });
      if (!put.ok) throw new Error("The upload did not complete. Try again.");
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
      setResult(data); setPhase("done");
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
    setPhase("uploading");
    try {
      const res = await fetch(`/samples/${sample.file}`);
      if (!res.ok) throw new Error(`Could not fetch that example (HTTP ${res.status}).`);
      const blob = await res.blob();
      await start(new File([blob], sample.file, { type: "text/csv" }));
    } catch (e) {
      // start() sets its own error; only report failures from fetching the file.
      if (e instanceof Error && e.message.startsWith("Could not fetch")) {
        setError(e.message);
        setPhase("idle");
      }
    }
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
            <p className="display text-2xl">Drop a table here</p>
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
              CSV or Parquet · {LIMITS_COPY.file} · {LIMITS_COPY.rows} · {LIMITS_COPY.perDay}
            </p>
          </div>

          <div>
            <p className="eyebrow mb-4">Or try one of these</p>
            <div className="grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2">
              {SAMPLES.map((s) => (
                <button
                  key={s.file}
                  onClick={() => void loadSample(s)}
                  className="group bg-surface p-6 text-left transition-colors hover:bg-surface-sunk"
                >
                  <p className="text-[0.9375rem] text-ink">{s.label}</p>
                  <p className="mt-1 text-[0.8125rem] text-muted">{s.hint}</p>
                </button>
              ))}
            </div>
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
        <div className="space-y-8">
          <div className="grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3">
            <div className="bg-surface p-7">
              <p className="eyebrow mb-4">
                {result.mode === "evaluate" ? "Scored on held-out rows" : "Rows filled in"}
              </p>
              <p className="display text-[2.25rem]">{result.nPredicted.toLocaleString()}</p>
            </div>
            <div className="bg-surface p-7">
              <p className="eyebrow mb-4">Learned from</p>
              <p className="display text-[2.25rem]">{result.nContext.toLocaleString()}</p>
              <p className="mt-1 text-[0.75rem] text-muted">rows of context</p>
            </div>
            <div className="bg-surface p-7">
              <p className="eyebrow mb-4">Time</p>
              <p className="display text-[2.25rem]">{(result.durationMs / 1000).toFixed(1)}s</p>
              <p className="mt-1 text-[0.75rem] text-muted">no training run</p>
            </div>
          </div>

          {result.droppedFeatures.length > 0 && (
            <div className="rounded-xl border border-line bg-surface p-7">
              <p className="eyebrow mb-3">
                Predicted from {result.featuresUsed} column
                {result.featuresUsed === 1 ? "" : "s"} · {result.droppedFeatures.length} left out
              </p>
              <p className="text-[0.9375rem] text-muted">
                Seldon reads numbers, and categories are encoded as numbers. Free text and
                identifiers have no meaningful encoding, so these were ignored rather than
                turned into noise:
              </p>
              <ul className="mt-4 flex flex-wrap gap-2">
                {result.droppedFeatures.map((d) => (
                  <li
                    key={d.name}
                    className="rounded-full bg-surface-sunk px-3 py-1 font-mono text-[0.6875rem] text-ink-soft"
                  >
                    {d.name}
                    <span className="text-muted"> ({d.reason})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.metrics && (
            <div className="rounded-xl border border-line bg-surface p-7">
              <p className="eyebrow mb-2">
                Your column was already complete, so we hid a fifth of it and guessed it back
              </p>
              <div className="mt-4 flex flex-wrap gap-x-10 gap-y-3">
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
            </div>
          )}

          <div className="overflow-hidden rounded-xl border border-line bg-surface-raised">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-7 py-4">
              <p className="text-[0.9375rem] text-ink">
                First {result.preview.length} rows, answer first, inputs alongside
              </p>
              <p className="font-mono text-[0.6875rem] tracking-wide text-muted uppercase">
                {result.previewColumns.length} input column
                {result.previewColumns.length === 1 ? "" : "s"}
                {result.previewTruncated ? " (first 40)" : ""} · scroll sideways
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-[0.8125rem] whitespace-nowrap">
                <thead>
                  <tr className="border-b border-line font-mono text-[0.6875rem] tracking-wide text-muted uppercase">
                    {/* One pinned cell, not three. Separate sticky columns need
                        hard-coded left offsets that drift from the widths the
                        browser actually computes, and the labels collide. */}
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
                          <span className="flex w-24 items-center gap-2 text-muted">
                            {p.confidence === null ? (
                              ""
                            ) : (
                              <>
                                <span className="h-1.5 w-8 shrink-0 rounded-full bg-surface-sunk">
                                  <span
                                    className="block h-1.5 rounded-full"
                                    style={{
                                      width: `${p.confidence * 100}%`,
                                      background: "var(--seq-4)",
                                    }}
                                  />
                                </span>
                                {(p.confidence * 100).toFixed(1)}%
                              </>
                            )}
                          </span>
                        </span>
                      </td>
                      {p.values.map((v, i) => (
                        <td key={result.previewColumns[i]} className="px-4 py-2.5 text-ink-soft">
                          {v === null || v === "" ? <span className="text-muted"></span> : String(v)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {result.analysis && (
            <div>
              <div className="mb-6">
                <p className="eyebrow mb-2">Reading the predictions</p>
                <p className="max-w-xl text-[0.9375rem] text-muted">
                  A prediction is worth the decision it changes, so the useful questions are
                  whether the mix looks plausible, where the model is unsure, and what
                  actually separates the groups.
                </p>
              </div>
              <PredictionAnalysis analysis={result.analysis} target={result.target} />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <a
              href={result.downloadUrl}
              className="btn-primary rounded-md px-6 py-3 text-[0.9375rem] transition-all"
            >
              Download all {result.nPredicted.toLocaleString()} predictions
            </a>
            <button onClick={reset} className="text-[0.875rem] text-muted hover:text-ink">
              Predict something else
            </button>
          </div>
          <p className="text-[0.8125rem] text-muted">
            Your uploaded file was deleted the moment this finished. The predictions expire
            in 24 hours.
          </p>
        </div>
      )}

    </div>
  );
}
