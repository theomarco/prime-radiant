import Link from "next/link";
import { Reveal } from "@/components/reveal";

const AXIOMS = [
  {
    n: "01",
    title: "Cheap answers make better questions.",
    body: "When an answer costs six months, you ask once and live with the framing. When it costs a minute, you ask a hundred ways, and the question itself improves. The scarce resource was never the model. It was always the framing.",
  },
  {
    n: "02",
    title: "A prediction is worth the decision it changes.",
    body: "Nothing more. Accuracy is the means. The moved intervention, the saved renewal, the machine inspected in time: that is the value, and it is counted in outcomes, not decimal points.",
  },
  {
    n: "03",
    title: "The long tail of decisions is where the value hides.",
    body: "Every organization carries a thousand questions too small for a project and too costly to ignore. Priced as projects, they stay unanswered forever. Priced as queries, they come alive.",
  },
  {
    n: "04",
    title: "A trained model begins to die the day it ships.",
    body: "A prediction computed on today's table cannot go stale. Prediction should be a fresh act, not a preserved artifact.",
  },
];

const EVIDENCE = [
  { label: "Machine failure", rows: "6,400 rows of context", metric: "98.3%", sub: "accuracy on 1,600 unseen rows" },
  { label: "Customer churn", rows: "8,000 rows of context", metric: "86.9%", sub: "accuracy on 2,000 unseen rows" },
  { label: "Time to answer", rows: "no training run", metric: "1.5s", sub: "end to end, both of them" },
];

export default function Home() {
  return (
    <div className="mx-auto max-w-3xl px-6">
      {/* ------------------------------------------------------------ hero */}
      <section className="pt-24 pb-20 sm:pt-32">
        <Reveal>
          <p className="eyebrow mb-8">The Prediction Manifesto</p>
          <h1 className="display text-[2.75rem] sm:text-[4rem]">
            By 2028, data science will be something you do, not someone you hire.
          </h1>
          <p className="mt-10 text-lg text-ink-soft">
            This is not a provocation. It is arithmetic. The guild will call it treason.
            It is only counting.
          </p>
        </Reveal>
      </section>

      <hr className="border-line" />

      {/* --------------------------------------------------------- the case */}
      <section className="py-20">
        <Reveal className="space-y-7 text-[1.0625rem] text-ink-soft">
          <p>
            The world runs on tables. Every loan, every policy, every shipment, every
            machine that is about to fail exists somewhere as a row with columns. The
            most consequential data of our civilization was never text or images. It has
            always been structured records, accumulating quietly for fifty years, waiting
            for a mathematics capable of reading them.
          </p>
          <p>
            That mathematics now exists. Tabular foundation models, trained on millions of
            datasets, can look at a table they have never seen and answer without a
            training run. What happened to language in this decade is happening to
            structured data now. It arrived without ceremony, and almost no one has
            noticed.
          </p>
        </Reveal>

        <Reveal index={1} className="mt-14">
          <div className="grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2">
            <div className="bg-surface p-8">
              <p className="eyebrow mb-4">The old craft</p>
              <p className="display text-3xl">Six figures, six months</p>
              <p className="mt-4 text-[0.9375rem] text-muted">
                Feature engineering, tuning, validation — a priesthood&apos;s ritual to
                answer a single question. Who leaves. Who defaults. What breaks next.
              </p>
            </div>
            <div className="bg-surface p-8">
              <p className="eyebrow mb-4">What the physics permits</p>
              <p className="display text-3xl">A cent, a minute</p>
              <p className="mt-4 text-[0.9375rem] text-muted">
                When a gap of that size opens between the price of a thing and its cost,
                no decree can hold it shut.
              </p>
            </div>
          </div>
          <p className="mt-8 text-[1.0625rem] text-ink-soft">
            The fall of the old craft is certain. Only its duration is negotiable.
          </p>
        </Reveal>
      </section>

      <hr className="border-line" />

      {/* ------------------------------------------------------------ axioms */}
      <section className="py-20">
        <Reveal>
          <p className="eyebrow mb-10">The axioms</p>
        </Reveal>
        <ol className="space-y-px overflow-hidden rounded-xl border border-line bg-line">
          {AXIOMS.map((axiom, i) => (
            <Reveal as="li" key={axiom.n} index={i} className="bg-surface">
              <div className="flex gap-6 p-8 sm:gap-10 sm:p-10">
                <span className="font-mono text-[0.6875rem] tracking-widest text-muted pt-1.5">
                  {axiom.n}
                </span>
                <div>
                  <h2 className="display text-2xl">{axiom.title}</h2>
                  <p className="mt-3 text-[0.9375rem] text-muted">{axiom.body}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </ol>
      </section>

      <hr className="border-line" />

      {/* ---------------------------------------------------------- evidence */}
      <section className="py-20">
        <Reveal>
          <p className="eyebrow mb-3">Not an argument — a measurement</p>
          <p className="max-w-xl text-[1.0625rem] text-ink-soft">
            Two public benchmarks, run through this site&apos;s own endpoint. No training,
            no tuning, no feature engineering. The table went in as it was.
          </p>
        </Reveal>
        <div className="mt-10 grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3">
          {EVIDENCE.map((item, i) => (
            <Reveal key={item.label} index={i} className="bg-surface p-8">
              <p className="eyebrow mb-5">{item.label}</p>
              <p className="display text-[2.5rem]">{item.metric}</p>
              <p className="mt-2 text-[0.8125rem] text-muted">{item.sub}</p>
              <p className="mt-5 font-mono text-[0.6875rem] tracking-wide text-muted">
                {item.rows}
              </p>
            </Reveal>
          ))}
        </div>
      </section>

      <hr className="border-line" />

      {/* ----------------------------------------------------------- closing */}
      <section className="py-20 pb-28">
        <Reveal className="space-y-7 text-[1.0625rem] text-ink-soft">
          <p>
            Most will wait. The fall of a craft is never believed until it is complete.
            But a small fraction will read these axioms as instructions, and they will
            build. Not a better tool for the old priesthood: a new foundation for how
            decisions are made.
          </p>
          <p className="display text-2xl !leading-snug text-ink">
            They arrive with or without me. I intend to be early. The build begins now,
            in public.
          </p>
        </Reveal>

        <Reveal index={1} className="mt-12 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/predict"
            className="rounded-md bg-ink px-6 py-3.5 text-center text-[0.9375rem] text-white transition-colors hover:bg-[#333] active:scale-[0.98]"
          >
            Predict something
          </Link>
          <Link
            href="/board"
            className="rounded-md border border-line-strong bg-surface px-6 py-3.5 text-center text-[0.9375rem] text-ink transition-colors hover:border-ink active:scale-[0.98]"
          >
            Tell us what you&apos;d predict
          </Link>
        </Reveal>
      </section>
    </div>
  );
}
