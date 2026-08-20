"use client";

import { useState } from "react";
import { LIMITS_COPY } from "@/lib/limits";

const EXAMPLE = `id     country  age  months  balance   left
1001   FR       42   18      12400     no
1002   ES       31   4       0         yes
1003   DE       55   61      88100     no
1004   FR       28   2       3200
1005   ES       47   33      41900`;

type Item = { q: string; a: React.ReactNode };

const ITEMS: Item[] = [
  {
    q: "What kind of file does this take?",
    a: (
      <>
        <p>
          A table. One row per thing you are asking about, one column per fact you know
          about it, and a first row holding the column names. Saved as <code>.csv</code> or{" "}
          <code>.parquet</code>.
        </p>
        <p className="mt-3">
          If your data is already arranged as rows and columns somewhere, it is almost
          certainly already in the right shape.
        </p>
      </>
    ),
  },
  {
    q: "What should it actually look like?",
    a: (
      <>
        <p>Like this — five customers, and the question is whether they leave.</p>
        <pre className="mt-4 overflow-x-auto rounded-lg border border-line bg-surface-sunk p-4 font-mono text-[0.75rem] leading-relaxed text-ink-soft">
          {EXAMPLE}
        </pre>
        <p className="mt-4">
          The first three rows already have an answer in the last column, so they are what
          the model learns from. The last two are blank, so those are the ones you get
          back. Nothing else about the file needs to change.
        </p>
      </>
    ),
  },
  {
    q: "Which column gets predicted?",
    a: (
      <p>
        You choose it after the file is read, from a list of the columns it found. Leave
        that column empty on the rows you want answered and filled on the rows that should
        teach it. Ten filled rows is the minimum; more is better, and there is no upper
        limit worth worrying about.
      </p>
    ),
  },
  {
    q: "What if the column is already complete?",
    a: (
      <p>
        Then there is nothing to fill in, so a fifth of it is hidden and guessed back
        instead. You get a score for how often it was right on rows it could not see —
        which is the fastest way to find out whether any of this works on your data before
        you rely on it.
      </p>
    ),
  },
  {
    q: "What can it predict, and what can it not?",
    a: (
      <>
        <p>
          Categories. Yes or no, a status, a grade, which of several outcomes happened —
          anything where the answer is one of a set of possibilities.
        </p>
        <p className="mt-3">
          Not continuous amounts. A price, a temperature, a revenue figure — those are
          declined outright rather than quietly turned into buckets, because a bucket is
          not the answer you asked for. The column picker greys those out and says so
          before you commit.
        </p>
      </>
    ),
  },
  {
    q: "What about columns of names, identifiers or free text?",
    a: (
      <p>
        Left out of the calculation. Numbers are used as they are and categories are
        encoded, but a column of customer names or order numbers has no meaningful
        ordering, and inventing one dilutes the columns that do carry signal. The result
        names every column it ignored and why.
      </p>
    ),
  },
  {
    q: "How big can the file be?",
    a: (
      <p>
        {LIMITS_COPY.file}, up to {LIMITS_COPY.rows} and {LIMITS_COPY.cols}, at{" "}
        {LIMITS_COPY.perDay}. For scale, a public card-fraud benchmark of 227,845 rows
        across 30 columns comes back in under a minute.
      </p>
    ),
  },
  {
    q: "What happens to my file?",
    a: (
      <p>
        It is deleted the moment the prediction finishes — the predictions themselves
        expire after 24 hours, and a file uploaded but never used is swept within the hour.
        There is no account and no email. The only thing kept about you is a one-way hash
        of your address, used to count uploads against the daily limit and to stop the same
        person voting twice on the board.
      </p>
    ),
  },
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div>
      <p className="eyebrow mb-6">Before you upload</p>
      <div className="border-t border-line">
        {ITEMS.map((item, i) => {
          const isOpen = open === i;
          return (
            <div key={item.q} className="border-b border-line">
              <button
                onClick={() => setOpen(isOpen ? null : i)}
                aria-expanded={isOpen}
                className="flex w-full items-baseline justify-between gap-6 py-5 text-left transition-colors hover:text-accent"
              >
                <span className="text-[1.0625rem]">{item.q}</span>
                <span
                  aria-hidden="true"
                  className="shrink-0 font-mono text-[0.9375rem] text-muted"
                >
                  {isOpen ? "−" : "+"}
                </span>
              </button>
              {isOpen && (
                <div className="max-w-[62ch] pb-6 text-[0.9375rem] text-muted [&_code]:rounded [&_code]:bg-surface-sunk [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.8125rem] [&_code]:text-ink-soft">
                  {item.a}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
