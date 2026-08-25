"use client";

import { useState } from "react";
import type { ScoredRow, Workspace } from "@/lib/platform";

const pp = (n: number) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}pt`;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

const BAND: Record<ScoredRow["band"], { label: string; bg: string; fg: string }> = {
  hold: { label: "Hold", bg: "var(--pale-red)", fg: "var(--pale-red-ink)" },
  watch: { label: "Watch", bg: "var(--pale-yellow)", fg: "var(--pale-yellow-ink)" },
  send: { label: "Send", bg: "var(--pale-green)", fg: "var(--pale-green-ink)" },
};

/**
 * Raw scores, then why. Selecting a row builds the waterfall from the base rate
 * up to that customer's score, one feature at a time, so the answer to "why was
 * this held" is a list a marketer can read rather than a model artifact.
 */
export function Predictions({ workspace }: { workspace: Workspace }) {
  const [picked, setPicked] = useState(0);
  const row = workspace.scored[picked];

  // The waterfall shares one axis with the score, so bars are comparable.
  const steps = [...row.contributions, { feature: "everything else", value: "", effect: row.rest }];
  const ceiling = Math.max(row.score, workspace.baseline, ...steps.map((_, i) =>
    steps.slice(0, i + 1).reduce((a, s) => a + s.effect, workspace.baseline),
  )) * 1.08;
  const w = (v: number) => `${Math.max((v / ceiling) * 100, 0.6)}%`;

  let running = workspace.baseline;

  return (
    <div className="grid gap-3 lg:grid-cols-[19rem_1fr]">
      {/* --------------------------------------------------- raw scores --- */}
      <div className="rounded-xl border border-line bg-surface p-4">
        <p className="eyebrow mb-3">Scored rows</p>
        <div className="space-y-1">
          {workspace.scored.map((r, i) => {
            const on = i === picked;
            return (
              <button
                key={r.id}
                onClick={() => setPicked(i)}
                aria-pressed={on}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                  on ? "bg-surface-sunk" : "hover:bg-surface-sunk/60"
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-[0.75rem] text-ink-soft">{r.id}</span>
                  <span className="mt-1 flex h-1 w-full overflow-hidden rounded-full bg-surface-raised">
                    <span
                      className="h-full rounded-full"
                      style={{ width: pct(r.score), background: BAND[r.band].fg }}
                    />
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-mono text-[0.8125rem] text-ink">{pct(r.score)}</span>
                  <span
                    className="mt-0.5 block rounded-full px-1.5 font-mono text-[0.5625rem] tracking-wide uppercase"
                    style={{ background: BAND[r.band].bg, color: BAND[r.band].fg }}
                  >
                    {BAND[r.band].label}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-3 border-t border-line pt-3 text-[0.75rem] leading-relaxed text-muted">
          Four of 4.21M candidate sends scored this morning. Pick one to see what moved it.
        </p>
      </div>

      {/* ---------------------------------------------------- waterfall --- */}
      <div className="rounded-xl border border-line bg-surface p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h3 className="text-[0.9375rem] font-medium text-ink">
            Why {row.id} is a {BAND[row.band].label.toLowerCase()}
          </h3>
          <p className="font-mono text-[0.75rem] text-muted">
            base {pct(workspace.baseline)}
            <span aria-hidden className="px-1.5">&rarr;</span>
            <span style={{ color: BAND[row.band].fg }}>{pct(row.score)}</span>
          </p>
        </div>

        <div className="mt-5 space-y-1.5">
          <Step
            label="Everyone, before anything is known"
            value=""
            barLeft="0%"
            barWidth={w(workspace.baseline)}
            colour="var(--line-strong)"
            amount={pct(workspace.baseline)}
          />
          {steps.map((s) => {
            const from = running;
            running += s.effect;
            const lo = Math.min(from, running);
            return (
              <Step
                key={s.feature}
                label={s.feature}
                value={s.value}
                barLeft={w(lo)}
                barWidth={w(Math.abs(s.effect))}
                colour={s.effect >= 0 ? "var(--series-pred)" : "var(--series-base)"}
                amount={pp(s.effect)}
                dim={s.feature === "everything else"}
              />
            );
          })}
          <div className="flex items-center gap-3 border-t border-line pt-2.5">
            <span className="w-[13rem] shrink-0 text-[0.8125rem] font-medium text-ink">
              Chance of disengaging
            </span>
            <span className="relative h-2 flex-1">
              <span
                className="absolute inset-y-0 rounded-sm"
                style={{ left: "0%", width: w(row.score), background: BAND[row.band].fg, opacity: 0.35 }}
              />
            </span>
            <span className="w-16 shrink-0 text-right font-mono text-[0.8125rem] text-ink">
              {pct(row.score)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Step({
  label,
  value,
  barLeft,
  barWidth,
  colour,
  amount,
  dim = false,
}: {
  label: string;
  value: string;
  barLeft: string;
  barWidth: string;
  colour: string;
  amount: string;
  dim?: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 ${dim ? "opacity-55" : ""}`}>
      <span className="w-[13rem] shrink-0 text-[0.8125rem] text-ink-soft">
        {label}
        {value && <span className="ml-1.5 font-mono text-[0.75rem] text-muted">{value}</span>}
      </span>
      <span className="relative h-2 flex-1">
        <span
          className="absolute inset-y-0 rounded-sm"
          style={{ left: barLeft, width: barWidth, background: colour }}
        />
      </span>
      <span className="w-16 shrink-0 text-right font-mono text-[0.75rem] text-muted">{amount}</span>
    </div>
  );
}

/** Where the risk actually sits, across the one lever marketing controls. */
export function DriverDistribution({ workspace }: { workspace: Workspace }) {
  const peak = Math.max(...workspace.driver.bins.map((b) => b.atRisk));
  return (
    <div className="rounded-xl border border-line bg-surface p-5 sm:p-6">
      <h3 className="text-[0.9375rem] font-medium text-ink">
        Disengagement by {workspace.driver.feature}
      </h3>
      <p className="mt-2 max-w-2xl text-[0.875rem] leading-relaxed text-ink-soft">
        {workspace.driver.note}
      </p>
      <div className="mt-5 space-y-2">
        {workspace.driver.bins.map((b, i) => (
          <div key={b.bin} className="flex items-center gap-3">
            <span className="w-24 shrink-0 font-mono text-[0.75rem] text-muted">{b.bin}</span>
            <span className="flex h-3 flex-1 overflow-hidden rounded-sm bg-surface-sunk">
              <span
                className="bar-x h-full rounded-sm"
                style={{
                  width: `${(b.atRisk / peak) * 100}%`,
                  background: "var(--series-pred)",
                  ["--index" as string]: i,
                }}
              />
            </span>
            <span className="w-14 shrink-0 text-right font-mono text-[0.75rem] text-ink-soft">
              {b.atRisk.toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
      <p className="mt-4 font-mono text-[0.6875rem] text-muted">
        share of each group that disengaged within 30 days
      </p>
    </div>
  );
}
