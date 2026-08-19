"use client";

import { useEffect, useState } from "react";

type Idea = {
  id: string;
  created_at: string;
  what_to_predict: string;
  what_for: string;
  vote_count: number;
  voted: boolean;
};

const MAX_LEN = 500;

function timeAgo(iso: string) {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  const steps: [number, string][] = [
    [60, "second"], [60, "minute"], [24, "hour"], [7, "day"], [4.35, "week"], [12, "month"],
  ];
  let value = seconds;
  let unit = "second";
  for (const [size, name] of steps) {
    if (value < size) { unit = name; break; }
    value = Math.floor(value / size);
    unit = name;
  }
  if (unit === "second" && value < 30) return "just now";
  return `${value} ${unit}${value === 1 ? "" : "s"} ago`;
}

export function BoardClient() {
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [sort, setSort] = useState<"top" | "new">("top");
  const [whatToPredict, setWhatToPredict] = useState("");
  const [whatFor, setWhatFor] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thanks, setThanks] = useState(false);

  useEffect(() => {
    let live = true;
    setIdeas(null);
    fetch(`/api/ideas?sort=${sort}`)
      .then((r) => r.json())
      .then((d) => { if (live) setIdeas(d.ideas ?? []); })
      .catch(() => { if (live) setIdeas([]); });
    return () => { live = false; };
  }, [sort]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setSubmitting(true);
    try {
      const res = await fetch("/api/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ whatToPredict, whatFor }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setIdeas((prev) => [data.idea, ...(prev ?? [])]);
      setWhatToPredict(""); setWhatFor(""); setThanks(true);
      setTimeout(() => setThanks(false), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not post that.");
    } finally {
      setSubmitting(false);
    }
  };

  const vote = async (id: string) => {
    // optimistic — the server is the arbiter, but the button should feel instant
    setIdeas((prev) =>
      (prev ?? []).map((i) =>
        i.id === id
          ? { ...i, voted: !i.voted, vote_count: i.vote_count + (i.voted ? -1 : 1) }
          : i,
      ),
    );
    try {
      const res = await fetch("/api/ideas/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (res.ok) {
        setIdeas((prev) =>
          (prev ?? []).map((i) =>
            i.id === id ? { ...i, voted: data.voted, vote_count: data.voteCount } : i,
          ),
        );
      }
    } catch {
      /* the optimistic state stands; a refresh will reconcile */
    }
  };

  return (
    <div className="space-y-14">
      {/* -------------------------------------------------------------- form */}
      <form onSubmit={submit} className="overflow-hidden rounded-xl border border-line bg-surface">
        <label className="block border-b border-line px-8 py-7">
          <span className="eyebrow">What do you want to predict?</span>
          <textarea
            value={whatToPredict}
            onChange={(e) => setWhatToPredict(e.target.value.slice(0, MAX_LEN))}
            rows={2}
            required
            placeholder="Which of our suppliers is about to miss a delivery."
            className="mt-3 w-full resize-none bg-transparent text-[1.0625rem] text-ink outline-none placeholder:text-muted/60"
          />
        </label>
        <label className="block border-b border-line px-8 py-7">
          <span className="eyebrow">What are you going to do with the predictions?</span>
          <textarea
            value={whatFor}
            onChange={(e) => setWhatFor(e.target.value.slice(0, MAX_LEN))}
            rows={2}
            required
            placeholder="Call the three worst ones on Monday and re-order early."
            className="mt-3 w-full resize-none bg-transparent text-[1.0625rem] text-ink outline-none placeholder:text-muted/60"
          />
        </label>
        <div className="flex flex-wrap items-center gap-4 px-8 py-5">
          <button
            type="submit"
            disabled={submitting || whatToPredict.trim().length < 3 || whatFor.trim().length < 3}
            className="rounded-md bg-ink px-6 py-3 text-[0.9375rem] text-white transition-colors hover:bg-[#333] active:scale-[0.98] disabled:opacity-40"
          >
            {submitting ? "Posting…" : "Post it"}
          </button>
          <span className="text-[0.8125rem] text-muted">
            No account, no email. {thanks && <span className="text-pale-green-ink">Posted — thank you.</span>}
          </span>
        </div>
        {error && (
          <p className="border-t border-line bg-pale-red px-8 py-4 text-[0.875rem] text-pale-red-ink">
            {error}
          </p>
        )}
      </form>

      {/* -------------------------------------------------------------- list */}
      <div>
        <div className="mb-6 flex items-baseline justify-between">
          <p className="eyebrow">
            {ideas === null ? "Loading" : `${ideas.length} asked so far`}
          </p>
          <div className="flex gap-5 text-[0.8125rem]">
            {(["top", "new"] as const).map((option) => (
              <button
                key={option}
                onClick={() => setSort(option)}
                className={sort === option ? "text-ink" : "text-muted hover:text-ink"}
              >
                {option === "top" ? "Most wanted" : "Newest"}
              </button>
            ))}
          </div>
        </div>

        {ideas !== null && ideas.length === 0 && (
          <div className="rounded-xl border border-dashed border-line-strong px-8 py-16 text-center">
            <p className="display text-xl">Nothing here yet.</p>
            <p className="mt-2 text-[0.9375rem] text-muted">Be the first to ask for something.</p>
          </div>
        )}

        <ul className="space-y-px overflow-hidden rounded-xl bg-line empty:hidden [&:not(:empty)]:border [&:not(:empty)]:border-line">
          {(ideas ?? []).map((idea) => (
            <li key={idea.id} className="flex gap-6 bg-surface p-7">
              <button
                onClick={() => void vote(idea.id)}
                aria-pressed={idea.voted}
                aria-label={idea.voted ? "Remove your vote" : "Vote for this"}
                className={`flex h-14 w-12 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg border transition-colors ${
                  idea.voted
                    ? "border-ink bg-ink text-white"
                    : "border-line-strong bg-surface text-ink hover:border-ink"
                }`}
              >
                <svg width="11" height="7" viewBox="0 0 11 7" fill="none" aria-hidden>
                  <path d="M1 6L5.5 1.5L10 6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="square" />
                </svg>
                <span className="font-mono text-[0.75rem] leading-none">{idea.vote_count}</span>
              </button>
              <div className="min-w-0">
                <p className="text-[1.0625rem] text-ink">{idea.what_to_predict}</p>
                <p className="mt-2 text-[0.9375rem] text-muted">{idea.what_for}</p>
                <p className="mt-3 font-mono text-[0.6875rem] tracking-wide text-muted uppercase">
                  {timeAgo(idea.created_at)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
