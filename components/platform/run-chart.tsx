"use client";

import { useState } from "react";
import { formatUnit, type Unit } from "@/lib/platform";

/**
 * Predicted against actual, one point per scoring run.
 *
 * This is deliberately NOT a forecast curve. The model scores entities, not
 * time: each point is the aggregate of one run's per-entity scores. Runs newer
 * than the horizon have no outcome yet, so the actual line simply stops and the
 * predicted line carries on alone. That gap is the open call.
 */
export function RunChart({
  predicted,
  actual,
  unit,
  uncertainty = 0.03,
  title,
  compact = false,
}: {
  predicted: number[];
  actual: number[];
  unit: Unit;
  uncertainty?: number;
  title: string;
  compact?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const fmt = (n: number) => formatUnit(unit, n);

  const W = 640;
  const H = compact ? 240 : 180;
  const PAD_X = 8;
  const PAD_T = 14;
  const PAD_B = compact ? 8 : 24;

  const P = predicted.length;
  const A = actual.length;
  // The last closed run: everything to its right is still waiting on outcomes.
  const edge = A - 1;
  const openCount = P - A;

  const spread = predicted.map((v, i) =>
    i <= edge ? 0 : uncertainty * v * Math.sqrt((i - edge) / (P - 1 - edge)),
  );

  const all = [...predicted, ...actual, ...predicted.map((v, i) => v + spread[i]), ...predicted.map((v, i) => v - spread[i])];
  const lowest = Math.min(...all);
  const highest = Math.max(...all);
  const pad = (highest - lowest) * 0.14 || 1;
  const min = lowest - pad;
  const max = highest + pad;

  const x = (i: number) => PAD_X + (i / (P - 1)) * (W - PAD_X * 2);
  const y = (v: number) => PAD_T + (1 - (v - min) / (max - min)) * (H - PAD_T - PAD_B);
  const line = (vals: number[], from = 0) =>
    vals.map((v, k) => `${k ? "L" : "M"}${x(from + k).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");

  const openIdx = Array.from({ length: openCount + 1 }, (_, k) => edge + k);
  const band =
    line(openIdx.map((i) => predicted[i] + spread[i]), edge) +
    " " +
    [...openIdx]
      .reverse()
      .map((i) => `L${x(i).toFixed(1)} ${y(predicted[i] - spread[i]).toFixed(1)}`)
      .join(" ") +
    " Z";

  return (
    <figure className="m-0">
      <figcaption className="mb-2 flex h-4 items-center justify-between gap-4">
        <span className="flex items-center gap-3 font-mono text-[0.625rem] tracking-wide text-muted">
          <span className="flex items-center gap-1.5">
            <svg width="14" height="2" aria-hidden>
              <line x1="0" y1="1" x2="14" y2="1" stroke="var(--series-base)" strokeWidth="2" />
            </svg>
            actual
          </span>
          <span className="flex items-center gap-1.5">
            <svg width="14" height="2" aria-hidden>
              <line
                x1="0"
                y1="1"
                x2="14"
                y2="1"
                stroke="var(--series-pred)"
                strokeWidth="2"
                strokeDasharray="4 3"
              />
            </svg>
            predicted
          </span>
        </span>
        <span className="font-mono text-[0.625rem] text-ink-soft">
          {hover === null
            ? `${openCount} run${openCount === 1 ? "" : "s"} still open`
            : `run ${hover + 1} · predicted ${fmt(predicted[hover])}${
                hover < A ? ` · actual ${fmt(actual[hover])}` : " · no outcome yet"
              }`}
        </span>
      </figcaption>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={`${title}. Predicted per run: ${predicted
          .map(fmt)
          .join(", ")}. Actual outcome for the ${A} closed runs: ${actual.map(fmt).join(", ")}.`}
        onMouseLeave={() => setHover(null)}
      >
        {/* The unsettled stretch, marked as ground rather than as a line. */}
        <rect
          x={x(edge)}
          y={0}
          width={W - PAD_X - x(edge)}
          height={H - PAD_B}
          fill="var(--surface-sunk)"
          opacity="0.55"
        />
        <path d={band} fill="var(--series-pred)" opacity="0.14" />
        <line
          x1={x(edge)}
          x2={x(edge)}
          y1={PAD_T - 6}
          y2={H - PAD_B}
          stroke="var(--line-strong)"
          strokeWidth="1"
          strokeDasharray="2 3"
        />

        <path
          d={line(predicted)}
          fill="none"
          stroke="var(--series-pred)"
          strokeWidth="2"
          strokeDasharray="5 4"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={line(actual)}
          fill="none"
          stroke="var(--series-base)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />

        <circle cx={x(edge)} cy={y(actual[A - 1])} r="3.5" fill="var(--series-base)" />
        <circle cx={x(P - 1)} cy={y(predicted[P - 1])} r="3.5" fill="var(--series-pred)" />

        {!compact && (
          <>
            <text x={PAD_X} y={H - 6} fill="var(--muted)" className="font-mono" fontSize="10">
              {P} runs ago
            </text>
            <text
              x={x(edge)}
              y={H - 6}
              fill="var(--muted)"
              className="font-mono"
              fontSize="10"
              textAnchor="middle"
            >
              last closed
            </text>
            <text
              x={W - PAD_X}
              y={H - 6}
              fill="var(--muted)"
              className="font-mono"
              fontSize="10"
              textAnchor="end"
            >
              latest
            </text>
          </>
        )}

        {hover !== null && (
          <>
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={PAD_T - 6}
              y2={H - PAD_B}
              stroke="var(--line-strong)"
              strokeWidth="1"
            />
            {hover < A && (
              <circle
                cx={x(hover)}
                cy={y(actual[hover])}
                r="4.5"
                fill="var(--series-base)"
                stroke="var(--surface)"
                strokeWidth="2"
              />
            )}
            <circle
              cx={x(hover)}
              cy={y(predicted[hover])}
              r="4.5"
              fill="var(--series-pred)"
              stroke="var(--surface)"
              strokeWidth="2"
            />
          </>
        )}

        {/* Hit targets, wider than the marks they select. */}
        {predicted.map((_, i) => (
          <rect
            key={i}
            x={x(i) - (W - PAD_X * 2) / (P - 1) / 2}
            y={0}
            width={(W - PAD_X * 2) / (P - 1)}
            height={H}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>
    </figure>
  );
}
