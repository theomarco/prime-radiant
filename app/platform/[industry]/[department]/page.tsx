import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { RunChart } from "@/components/platform/run-chart";
import { DriverDistribution, Predictions } from "@/components/platform/predictions";
import { WORKSPACES, findWorkspace } from "@/lib/platform";

export function generateStaticParams() {
  return WORKSPACES.map((w) => ({ industry: w.industrySlug, department: w.departmentSlug }));
}

export async function generateMetadata(
  props: PageProps<"/platform/[industry]/[department]">,
): Promise<Metadata> {
  const { industry, department } = await props.params;
  const w = findWorkspace(industry, department);
  if (!w) return { title: "Not found · Prime Radiant" };
  return {
    // Unlinked and unindexed while under review. Remove `robots` to publish.
    robots: { index: false, follow: false },
    title: `${w.industry} · ${w.department} · Prime Radiant`,
    description: w.blurb,
  };
}

function Stage({
  n,
  title,
  lede,
  children,
}: {
  n: string;
  title: string;
  lede?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-16 border-t border-line pt-10">
      <div className="flex items-baseline gap-4">
        <span className="font-mono text-[0.6875rem] tracking-[0.14em] text-muted">{n}</span>
        <h2 className="text-[1.375rem] font-medium tracking-tight text-ink">{title}</h2>
      </div>
      {lede && <p className="mt-3 max-w-2xl text-[0.9375rem] leading-relaxed text-ink-soft">{lede}</p>}
      <div className="mt-7">{children}</div>
    </section>
  );
}

const TH = "px-4 py-2.5 text-left font-mono text-[0.625rem] tracking-[0.14em] text-muted uppercase";
const TD = "px-4 py-3.5 align-top text-[0.8125rem] text-ink-soft";

export default async function PlatformPage(
  props: PageProps<"/platform/[industry]/[department]">,
) {
  const { industry, department } = await props.params;
  const w = findWorkspace(industry, department);
  if (!w) notFound();

  return (
    <div className="mx-auto max-w-5xl px-6 pt-20 pb-28">
      <p className="eyebrow mb-6">
        {w.industry} · {w.department}
      </p>
      <h1 className="display max-w-3xl text-[2.5rem] sm:text-[3.25rem]">{w.title}</h1>
      <p className="mt-7 max-w-xl text-[1.0625rem] text-ink-soft">{w.blurb}</p>

      {/* ========================================================== 01 === */}
      <Stage n="01" title="Where the data comes from" lede={w.problem}>
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[46rem] border-collapse">
            <thead>
              <tr className="border-b border-line">
                {["Source", "Type", "What it provides", "Volume", "Sync"].map((h) => (
                  <th key={h} className={TH}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {w.sources.map((s) => (
                <tr key={s.name}>
                  <td className={`${TD} font-medium whitespace-nowrap text-ink`}>{s.name}</td>
                  <td className={`${TD} whitespace-nowrap`}>
                    <span className="rounded-md border border-line bg-surface-sunk px-2 py-0.5 font-mono text-[0.6875rem]">
                      {s.kind}
                    </span>
                  </td>
                  <td className={TD}>{s.provides}</td>
                  <td className={`${TD} font-mono text-[0.75rem] whitespace-nowrap`}>{s.volume}</td>
                  <td className={`${TD} font-mono text-[0.75rem] whitespace-nowrap`}>{s.sync}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 max-w-2xl text-[0.875rem] leading-relaxed text-ink-soft">{w.joinNote}</p>
      </Stage>

      {/* ========================================================== 02 === */}
      <Stage
        n="02"
        title="How the problem becomes a scored table"
        lede="The business question is a decision, and a decision is not a prediction. It splits into two things a model can answer and one thing it should not."
      >
        <p className="rounded-xl border border-line bg-surface-sunk px-5 py-4 text-[1.0625rem] text-ink">
          {w.decision}
        </p>

        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {w.tasks.map((t) => (
            <div key={t.id} className="rounded-xl border border-line bg-surface p-5">
              <p className="font-mono text-[0.75rem] text-muted">{t.id}</p>
              <h3 className="mt-1.5 text-[0.9375rem] font-medium text-ink">{t.question}</h3>
              <dl className="mt-4 space-y-1.5 text-[0.8125rem]">
                {[
                  ["One row is", t.entity],
                  ["Label", t.label],
                  ["Horizon", t.horizon],
                  ["Happens to", t.positiveRate],
                  ["Learns from", t.labelled],
                ].map(([k, v]) => (
                  <div key={k} className="flex gap-3">
                    <dt className="w-24 shrink-0 text-muted">{k}</dt>
                    <dd className="flex-1 text-ink-soft">{v}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-5 border-t border-line pt-4">
                <RunChart
                  predicted={t.predicted}
                  actual={t.actual}
                  unit={t.unit}
                  title={t.question}
                  compact
                />
              </div>
            </div>
          ))}
        </div>

        {/* Deliberately not styled like the model cards above it. */}
        <div className="mt-3 rounded-xl border border-dashed border-line-strong p-5">
          <p className="eyebrow mb-3">And then, not a model</p>
          <p className="rounded-lg bg-surface-sunk px-4 py-3 font-mono text-[0.8125rem] leading-relaxed text-ink">
            {w.policy.rule}
          </p>
          <p className="mt-4 max-w-2xl text-[0.875rem] leading-relaxed text-ink-soft">
            {w.policy.note}
          </p>
        </div>
      </Stage>

      {/* ========================================================== 03 === */}
      <Stage
        n="03"
        title="What the scores say, and why"
        lede="Every candidate send gets a number. The number is worth nothing on its own, so each one comes with the features that produced it."
      >
        <Predictions workspace={w} />
        <div className="mt-3">
          <DriverDistribution workspace={w} />
        </div>
      </Stage>

      {/* ========================================================== 04 === */}
      <Stage
        n="04"
        title="What acts on them"
        lede="The scores meet the policy once per send window. What comes out is a queue, and a tenth of the audience is deliberately left out of it."
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Candidate sends today", w.queue.candidates, "before any decision"],
            ["Held", w.queue.held, "policy said no"],
            ["Allowed", w.queue.allowed, "delivered"],
            ["Control group", w.queue.holdout, "receives everything"],
          ].map(([k, v, note]) => (
            <div key={k} className="rounded-xl border border-line bg-surface p-4">
              <p className="font-mono text-[0.6875rem] text-muted">{k}</p>
              <p className="mt-1.5 text-[1.5rem] leading-none font-medium tracking-tight text-ink">
                {v}
              </p>
              <p className="mt-1.5 text-[0.75rem] text-muted">{note}</p>
            </div>
          ))}
        </div>

        <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[38rem] border-collapse">
            <thead>
              <tr className="border-b border-line">
                {["Measure", "Decided sends", "Control", "Difference"].map((h) => (
                  <th key={h} className={TH}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {w.measures.map((m) => (
                <tr key={m.name}>
                  <td className={`${TD} font-medium text-ink`}>{m.name}</td>
                  <td className={`${TD} font-mono text-[0.8125rem]`}>{m.treated}</td>
                  <td className={`${TD} font-mono text-[0.8125rem]`}>{m.control}</td>
                  <td
                    className={`${TD} font-mono text-[0.8125rem]`}
                    style={{ color: m.good ? "var(--pale-green-ink)" : "var(--pale-red-ink)" }}
                  >
                    {m.delta}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-4 max-w-2xl text-[0.875rem] leading-relaxed text-ink-soft">
          {w.measuredNote}
        </p>
        <p className="mt-6 font-mono text-[0.6875rem] leading-relaxed text-muted">{w.schedule}</p>
        <p className="mt-3 font-mono text-[0.6875rem] text-muted">
          Sample workspace. Every figure on this page is invented.
        </p>
      </Stage>
    </div>
  );
}
