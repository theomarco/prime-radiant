import type { Metadata } from "next";
import Link from "next/link";
import { WORKSPACES, workspacePath } from "@/lib/platform";

export const metadata: Metadata = {
  // Reachable by URL, deliberately not linked from the site and not indexed
  // while it is under review. Remove `robots` to publish it.
  robots: { index: false, follow: false },
  title: "The platform · Prime Radiant",
  description:
    "Connect the tables you already have, run predictions on a schedule, and measure the workflow that acts on them against a holdout.",
};

export default function PlatformIndex() {
  return (
    <div className="mx-auto max-w-3xl px-6 pt-20 pb-28">
      <p className="eyebrow mb-6">The platform</p>
      <h1 className="display max-w-2xl text-[2.5rem] sm:text-[3.25rem]">
        A prediction nobody acts on is a report.
      </h1>
      <p className="mt-7 max-w-xl text-[1.0625rem] text-ink-soft">
        Four steps, in this order, every time. Connect the tables that already exist. Run
        predictions against them on a schedule. Watch for what moves. Act on it, holding a
        share back so the difference can be measured.
      </p>
      <p className="mt-5 max-w-xl text-[1.0625rem] text-ink-soft">
        The sources change by industry and the questions change by team. The loop does not.
      </p>

      <div className="mt-14">
        <p className="eyebrow mb-4">Worked examples</p>
        <div className="divide-y divide-[var(--line)] border-y border-line">
          {WORKSPACES.map((w) => (
            <Link
              key={workspacePath(w)}
              href={workspacePath(w)}
              className="group flex items-baseline justify-between gap-4 py-5 transition-colors"
            >
              <span>
                <span className="text-[1.0625rem] text-ink transition-colors group-hover:text-accent">
                  {w.industry} · {w.department}
                </span>
                <span className="mt-1 block text-[0.875rem] text-muted">
                  {w.tasks.length} scored tables and one policy, {w.sources.length} connected sources
                </span>
              </span>
              <span className="font-mono text-[0.75rem] text-muted">Open</span>
            </Link>
          ))}
        </div>
        <p className="mt-6 text-[0.875rem] text-muted">
          Sample workspaces. Every figure is invented.
        </p>
      </div>
    </div>
  );
}
