"use client";

import { useState, type ReactNode } from "react";

export type Analysis = {
  predictedMix: { label: string; count: number; share: number }[];
  baseMix: { label: string; count: number; share: number }[];
  confidenceBands?: { from: number; to: number; count: number }[];
  medianConfidence?: number | null;
  needsReview?: {
    count: number;
    threshold: number;
    rows: { row: number; prediction: unknown; confidence: number }[];
  };
  groups?: { a: string; b: string; aCount: number; bCount: number };
  drivers?: {
    name: string;
    kind: "numeric" | "categorical";
    separation: number;
    group_a_mean?: number;
    group_b_mean?: number;
    value?: string;
    group_a_share?: number;
    group_b_share?: number;
  }[];
  confusion?: { labels: string[]; matrix: number[][] };
};

const pct = (n: number) => `${(n * 100).toFixed(n < 0.01 && n > 0 ? 2 : 1)}%`;
const num = (n: number) =>
  Math.abs(n) >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : n.toFixed(2);

/* ------------------------------------------------------------- tooltip --- */
/** Hover/focus layer. An HTML chart is interactive by default, so every mark
 *  carries one; keyboard focus gets the same treatment as the pointer. */
function Tip({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 -translate-x-1/2 rounded-md border border-line bg-surface px-2.5 py-1.5 font-mono text-[0.6875rem] whitespace-nowrap text-ink shadow-[0_2px_8px_rgba(0,0,0,0.04)]"
        >
          {label}
        </span>
      )}
    </span>
  );
}

function Panel({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-7">
      <p className="eyebrow">{title}</p>
      {note && <p className="mt-2 max-w-xl text-[0.875rem] text-muted">{note}</p>}
      <div className="mt-6">{children}</div>
    </section>
  );
}

/* -------------------------------------------------------------- the mix --- */
/** Grouped bars: classes are the categories, and the two series are "what you
 *  gave us" vs "what came back". Making the series the pair — rather than one
 *  hue per class — means this reads the same for two classes or twenty. */
function MixChart({ analysis, target }: { analysis: Analysis; target: string }) {
  const labels = Array.from(
    new Set([...analysis.baseMix.map((d) => d.label), ...analysis.predictedMix.map((d) => d.label)]),
  );
  const shareOf = (rows: Analysis["baseMix"], label: string) =>
    rows.find((r) => r.label === label)?.share ?? 0;
  const countOf = (rows: Analysis["baseMix"], label: string) =>
    rows.find((r) => r.label === label)?.count ?? 0;
  const max = Math.max(
    ...labels.flatMap((l) => [shareOf(analysis.baseMix, l), shareOf(analysis.predictedMix, l)]),
    0.01,
  );
  const biggestGap = Math.max(
    ...labels.map((l) => Math.abs(shareOf(analysis.baseMix, l) - shareOf(analysis.predictedMix, l))),
  );

  const SERIES = [
    { key: "base" as const, name: "In the rows you labelled", color: "var(--series-base)", rows: analysis.baseMix },
    { key: "pred" as const, name: "In the predictions", color: "var(--series-pred)", rows: analysis.predictedMix },
  ];

  return (
    <Panel
      title={`How often each ${target} came back`}
      note={
        biggestGap > 0.15
          ? `The predicted mix differs from your labelled rows by up to ${pct(biggestGap)}. That can be real — or a sign the rows you left blank aren't like the ones you filled in.`
          : "Close to the mix in your labelled rows, which is the first thing worth checking."
      }
    >
      <div className="mb-5 flex flex-wrap gap-5">
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-2 text-[0.8125rem] text-ink-soft">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>

      <div className="space-y-5">
        {labels.map((label, i) => (
          <div key={label}>
            <p className="mb-2 font-mono text-[0.75rem] text-ink">{label}</p>
            <div className="space-y-1">
              {SERIES.map((s) => {
                const share = shareOf(s.rows, label);
                const count = countOf(s.rows, label);
                return (
                  <div key={s.key} className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <Tip label={`${s.name}: ${count.toLocaleString()} rows (${pct(share)})`}>
                        <span
                          tabIndex={0}
                          className="flex h-6 w-full items-center outline-none focus-visible:ring-2 focus-visible:ring-ink"
                        >
                          <span
                            className="bar-x block h-3 rounded-r-[4px]"
                            style={{
                              width: `max(2px, ${(share / max) * 100}%)`,
                              background: s.color,
                              ["--index" as string]: i,
                            }}
                          />
                        </span>
                      </Tip>
                    </div>
                    <span className="w-14 shrink-0 text-right font-mono text-[0.6875rem] text-muted">
                      {pct(share)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------- confidence ------- */
function ConfidenceChart({ analysis }: { analysis: Analysis }) {
  const bands = analysis.confidenceBands ?? [];
  if (!bands.length) return null;
  const max = Math.max(...bands.map((b) => b.count), 1);
  const RAMP = ["var(--seq-1)", "var(--seq-2)", "var(--seq-3)", "var(--seq-4)", "var(--seq-5)"];

  return (
    <Panel
      title="How sure the model was"
      note={
        analysis.medianConfidence != null
          ? `Half the rows came back above ${pct(analysis.medianConfidence)}. Low-confidence rows aren't wrong, but they're where a human adds the most.`
          : undefined
      }
    >
      <div className="flex items-end gap-2" style={{ height: "9rem" }}>
        {bands.map((band, i) => (
          <div key={i} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-2">
            <span className="font-mono text-[0.6875rem] text-ink">{band.count.toLocaleString()}</span>
            <Tip label={`${band.count.toLocaleString()} rows between ${pct(band.from)} and ${pct(Math.min(band.to, 1))}`}>
              <span
                tabIndex={0}
                className="flex w-full min-w-6 items-end justify-center outline-none focus-visible:ring-2 focus-visible:ring-ink"
              >
                <span
                  className="bar-y block w-full rounded-t-[4px]"
                  style={{
                    height: `max(3px, ${(band.count / max) * 6.5}rem)`,
                    background: RAMP[Math.min(i, RAMP.length - 1)],
                    ["--index" as string]: i,
                  }}
                />
              </span>
            </Tip>
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-2 border-t border-line pt-3">
        {bands.map((band, i) => (
          <span key={i} className="min-w-0 flex-1 text-center font-mono text-[0.625rem] tracking-wide text-muted">
            {`${Math.round(band.from * 100)}–${Math.round(Math.min(band.to, 1) * 100)}%`}
          </span>
        ))}
      </div>
    </Panel>
  );
}

/* ---------------------------------------------------------- the drivers --- */
function DriverChart({ analysis }: { analysis: Analysis }) {
  const drivers = analysis.drivers ?? [];
  const groups = analysis.groups;
  if (!drivers.length || !groups) return null;
  const max = Math.max(...drivers.map((d) => d.separation), 0.01);

  return (
    <Panel
      title={`What separates "${groups.a}" from "${groups.b}"`}
      note="How differently each column behaves between the two predicted groups. This is an association, not a cause — a column can look decisive because it tracks something else that is."
    >
      <div className="space-y-4">
        {drivers.map((d, i) => {
          const detail =
            d.kind === "numeric" && d.group_a_mean != null && d.group_b_mean != null
              ? `averages ${num(d.group_a_mean)} vs ${num(d.group_b_mean)}`
              : d.value != null && d.group_a_share != null && d.group_b_share != null
                ? `"${d.value}" in ${pct(d.group_a_share)} vs ${pct(d.group_b_share)}`
                : "";
          return (
            <div key={d.name}>
              <div className="mb-1.5 flex items-baseline justify-between gap-4">
                <span className="truncate font-mono text-[0.75rem] text-ink">{d.name}</span>
                <span className="shrink-0 text-[0.75rem] text-muted">{detail}</span>
              </div>
              <Tip label={`${d.name} — separation ${d.separation.toFixed(2)} (${d.kind})`}>
                <span
                  tabIndex={0}
                  className="flex h-6 w-full items-center outline-none focus-visible:ring-2 focus-visible:ring-ink"
                >
                <span
                  className="bar-x block h-2.5 rounded-r-[4px]"
                  style={{
                    width: `max(2px, ${(d.separation / max) * 100}%)`,
                    background: "var(--series-base)",
                    ["--index" as string]: i,
                  }}
                />
                </span>
              </Tip>
            </div>
          );
        })}
      </div>
      <p className="mt-5 border-t border-line pt-4 text-[0.8125rem] text-muted">
        {groups.aCount.toLocaleString()} rows predicted &quot;{groups.a}&quot; ·{" "}
        {groups.bCount.toLocaleString()} predicted &quot;{groups.b}&quot;
      </p>
    </Panel>
  );
}

/* ------------------------------------------------------------ confusion --- */
function ConfusionMatrix({ analysis }: { analysis: Analysis }) {
  const c = analysis.confusion;
  if (!c) return null;
  const max = Math.max(...c.matrix.flat(), 1);
  const total = c.matrix.flat().reduce((a, b) => a + b, 0);
  const correct = c.labels.reduce((sum, _, i) => sum + (c.matrix[i]?.[i] ?? 0), 0);

  return (
    <Panel
      title="Where it was right and where it wasn't"
      note={`${correct.toLocaleString()} of ${total.toLocaleString()} held-out rows landed on the diagonal. Off-diagonal cells are the mistakes, and which side they fall on usually matters more than the total.`}
    >
      <div className="overflow-x-auto">
        <table className="border-separate" style={{ borderSpacing: "2px" }}>
          <thead>
            <tr>
              <th className="px-2 py-1 text-left font-mono text-[0.625rem] font-normal tracking-wide text-muted uppercase">
                actual ↓ predicted →
              </th>
              {c.labels.map((l) => (
                <th key={l} className="px-3 py-1 font-mono text-[0.6875rem] font-normal text-ink">
                  {l}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {c.labels.map((actual, i) => (
              <tr key={actual}>
                <th className="px-2 py-1 text-right font-mono text-[0.6875rem] font-normal text-ink">
                  {actual}
                </th>
                {c.labels.map((predicted, j) => {
                  const n = c.matrix[i]?.[j] ?? 0;
                  const strength = n / max;
                  const onDiagonal = i === j;
                  return (
                    <td key={predicted} className="p-0">
                      <Tip
                        label={`${n.toLocaleString()} rows: actually "${actual}", predicted "${predicted}"`}
                      >
                        <span
                          tabIndex={0}
                          className="flex h-14 w-20 items-center justify-center rounded-md font-mono text-[0.8125rem] outline-none focus-visible:ring-2 focus-visible:ring-ink"
                          style={{
                            background:
                              strength === 0
                                ? "var(--surface-sunk)"
                                : `var(--seq-${Math.min(5, Math.max(1, Math.ceil(strength * 5)))})`,
                            color: strength === 0 ? "var(--muted)" : "#fff",
                            boxShadow: onDiagonal ? "inset 0 0 0 1.5px var(--ink)" : undefined,
                          }}
                        >
                          {n.toLocaleString()}
                        </span>
                      </Tip>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/* ---------------------------------------------------------------- rows ---- */
function ReviewList({ analysis, target }: { analysis: Analysis; target: string }) {
  const review = analysis.needsReview;
  if (!review || review.count === 0) return null;
  return (
    <Panel
      title={`${review.count.toLocaleString()} rows worth a second look`}
      note={`These came back under ${pct(review.threshold)} confidence. If you only check some rows by hand, check these — it is where the model is closest to a coin flip.`}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[0.8125rem]">
          <thead>
            <tr className="border-b border-line font-mono text-[0.625rem] tracking-wide text-muted uppercase">
              <th className="py-2 pr-6 font-normal">Row</th>
              <th className="py-2 pr-6 font-normal">{target}</th>
              <th className="py-2 font-normal">Confidence</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {review.rows.map((r) => (
              <tr key={r.row} className="border-b border-line last:border-b-0">
                <td className="py-2 pr-6 text-muted">{r.row}</td>
                <td className="py-2 pr-6 text-ink">{String(r.prediction)}</td>
                <td className="py-2">
                  <span className="flex items-center gap-2">
                    <span className="h-1.5 w-20 rounded-full bg-surface-sunk">
                      <span
                        className="block h-1.5 rounded-full"
                        style={{ width: `${r.confidence * 100}%`, background: "var(--seq-4)" }}
                      />
                    </span>
                    <span className="text-muted">{pct(r.confidence)}</span>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

export function PredictionAnalysis({
  analysis,
  target,
}: {
  analysis: Analysis;
  target: string;
}) {
  return (
    <div className="space-y-px overflow-hidden rounded-xl bg-line">
      <MixChart analysis={analysis} target={target} />
      <ConfidenceChart analysis={analysis} />
      <DriverChart analysis={analysis} />
      <ConfusionMatrix analysis={analysis} />
      <ReviewList analysis={analysis} target={target} />
    </div>
  );
}
