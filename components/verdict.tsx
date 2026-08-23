"use client";

import { useState } from "react";

export type Explain = {
  target: string;
  actionable: string;
  exact: boolean;
  explained: number;
  actionableTotal: number;
  rows: Record<
    string,
    { p: number; base: number; rest: number; parts: { col: string; val: unknown; phi: number }[] }
  >;
};

export type RankedGroup = {
  label: string;
  count: number;
  rows: { row: number; confidence: number | null }[];
};

const pct = (n: number) => `${(n * 100).toFixed(n >= 0.9995 ? 1 : 0)}%`;

function value(v: unknown) {
  if (v === null || v === "") return "-";
  const n = Number(v);
  if (!Number.isNaN(n) && v !== true && v !== false) {
    return Number.isInteger(n) ? n.toLocaleString("en") : n.toLocaleString("en", { maximumFractionDigits: 2 });
  }
  return String(v);
}

/** One row's Shapley contributions, as a running total from the base rate. */
function Waterfall({ row }: { row: Explain["rows"][string] }) {
  const MIN = 0.005;
  const shown = row.parts.filter((p) => Math.abs(p.phi) >= MIN);
  // Anything under half a point is noise on this scale, and a column of "-0"
  // reads as broken rather than as small.
  const remainder =
    row.rest + row.parts.filter((p) => Math.abs(p.phi) < MIN).reduce((a, p) => a + p.phi, 0);
  const steps: { label: string; val?: unknown; phi: number }[] = shown.map((p) => ({
    label: p.col,
    val: p.val,
    phi: p.phi,
  }));
  if (Math.abs(remainder) >= MIN) steps.push({ label: "everything else", phi: remainder });

  let running = row.base;
  return (
    <div className="bg-surface px-6 pt-1 pb-6">
      <div className="flex items-center gap-4 py-1 text-[0.8125rem]">
        <span className="w-56 shrink-0 text-ink-soft">a typical row here</span>
        <span className="relative h-3.5 flex-1 rounded-sm bg-surface-sunk">
          <i className="absolute top-0 h-3.5 rounded-sm bg-muted" style={{ left: 0, width: `${row.base * 100}%` }} />
        </span>
        <span className="w-14 text-right font-mono text-ink-soft">{pct(row.base)}</span>
      </div>

      {steps.map((s, i) => {
        const from = running;
        running += s.phi;
        const lo = Math.min(from, running);
        const up = s.phi > 0;
        return (
          <div key={`${s.label}-${i}`} className="flex items-center gap-4 py-1 text-[0.8125rem]">
            <span className="w-56 shrink-0 truncate text-muted">
              {s.label} {s.val !== undefined && <b className="font-mono font-normal text-ink-soft">{value(s.val)}</b>}
            </span>
            <span className="relative h-3.5 flex-1 rounded-sm bg-surface-sunk">
              <i
                className="absolute top-0 h-3.5 rounded-sm"
                style={{
                  left: `${lo * 100}%`,
                  width: `${Math.max(Math.abs(s.phi) * 100, 0.5)}%`,
                  background: up ? "var(--series-pred)" : "var(--series-base)",
                }}
              />
            </span>
            <span
              className="w-14 text-right font-mono"
              style={{ color: up ? "var(--series-pred)" : "var(--series-base)" }}
            >
              {s.phi > 0 ? "+" : ""}
              {(s.phi * 100).toFixed(0)}
            </span>
          </div>
        );
      })}

      <div className="mt-1 flex items-center gap-4 border-t border-line pt-2 text-[0.8125rem]">
        <span className="w-56 shrink-0 text-ink-soft">this one</span>
        <span className="relative h-3.5 flex-1 rounded-sm bg-surface-sunk">
          <i className="absolute top-0 h-3.5 rounded-sm bg-muted" style={{ left: 0, width: `${row.p * 100}%` }} />
        </span>
        <span className="w-14 text-right font-mono text-ink">{pct(row.p)}</span>
      </div>
    </div>
  );
}

export function Verdict({
  ranked,
  explain,
  downloadUrl,
  nPredicted,
}: {
  ranked: RankedGroup[];
  explain: Explain | null;
  downloadUrl: string;
  nPredicted: number;
}) {
  // The server guesses the actionable class is the rarest one, which is right
  // for churn and fraud and wrong for credit score, where "Poor" is both common
  // and the one you act on. When explanations exist they name the label that was
  // actually explained, and that beats the guess.
  const ordered = explain
    ? [...ranked].sort(
        (a, b) => Number(b.label === explain.actionable) - Number(a.label === explain.actionable),
      )
    : ranked;
  const [active, setActive] = useState(0);
  const group = ordered[active];
  if (!group) return null;
  const headline = ordered[0];
  const explained = explain?.rows ?? {};

  return (
    <div className="space-y-8">
      <div>
        <h2 className="display max-w-[26ch] text-[1.9rem] sm:text-[2.3rem]">
          {nPredicted.toLocaleString()} rows came back.{" "}
          <span className="text-accent">
            {headline.count.toLocaleString()} of them are &ldquo;{headline.label}&rdquo;.
          </span>
        </h2>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <a
          href={downloadUrl}
          className="btn-primary rounded-md px-6 py-3 text-[0.9375rem] transition-all"
        >
          Download all {nPredicted.toLocaleString()} (CSV)
        </a>
        {ordered.length > 1 &&
          ordered.map((g, i) =>
            i === active ? null : (
              <button
                key={g.label}
                onClick={() => setActive(i)}
                className="btn-ghost rounded-md px-5 py-3 text-[0.9375rem] transition-all"
              >
                Show the {g.count.toLocaleString()} &ldquo;{g.label}&rdquo;
              </button>
            ),
          )}
      </div>

      <div>
        <p className="eyebrow mb-3">
          {active === 0 ? "The ones to look at first" : `Predicted “${group.label}”`}
          {Object.keys(explained).length > 0 && active === 0 ? " · open a row to see why" : ""}
        </p>
        <div className="overflow-hidden rounded-xl border border-line bg-surface-raised">
          {group.rows.map((r) => {
            const ex = explained[String(r.row)];
            const chips = ex?.parts.slice(0, 3) ?? [];
            const body = (
              <span className="flex flex-1 flex-wrap items-center gap-4">
                <span className="w-16 shrink-0 font-mono text-[0.8125rem] text-muted">{r.row}</span>
                <span className="w-24 shrink-0 text-[0.9375rem]">{group.label}</span>
                <span className="w-14 shrink-0 font-mono text-[0.8125rem] text-muted">
                  {r.confidence === null ? "-" : pct(r.confidence)}
                </span>
                <span className="flex flex-wrap gap-1.5">
                  {chips.map((c) => (
                    <span
                      key={c.col}
                      className="rounded-full border border-line bg-surface-sunk px-2.5 py-0.5 text-[0.75rem] text-muted"
                    >
                      {c.col} <b className="font-mono font-normal text-ink-soft">{value(c.val)}</b>{" "}
                      <em
                        className="font-mono not-italic"
                        style={{ color: c.phi > 0 ? "var(--series-pred)" : "var(--series-base)" }}
                      >
                        {c.phi > 0 ? "+" : ""}
                        {(c.phi * 100).toFixed(0)}
                      </em>
                    </span>
                  ))}
                </span>
              </span>
            );
            return ex ? (
              <details key={r.row} className="border-b border-line last:border-b-0">
                <summary className="flex cursor-pointer items-center px-6 py-3 transition-colors hover:bg-surface [&::-webkit-details-marker]:hidden">
                  {body}
                </summary>
                <Waterfall row={ex} />
              </details>
            ) : (
              <div key={r.row} className="flex items-center border-b border-line px-6 py-3 last:border-b-0">
                {body}
              </div>
            );
          })}
        </div>
        <p className="mt-4 max-w-[68ch] text-[0.8125rem] text-muted">
          Ranked by confidence, most certain first. Showing {group.rows.length} of{" "}
          {group.count.toLocaleString()}; every row is in the download.
          {explain && active === 0 && (
            <>
              {" "}
              The numbers beside each value are Shapley values: how much that value moved this row
              away from a typical one. They add up exactly to the final figure.{" "}
              {explain.exact
                ? "Computed exactly, over every combination of columns."
                : "Estimated by sampling, because this file has too many columns to enumerate every combination."}
              {explain.explained < explain.actionableTotal &&
                ` Explained for the ${explain.explained} most certain of ${explain.actionableTotal.toLocaleString()}.`}
            </>
          )}
        </p>
      </div>
    </div>
  );
}
