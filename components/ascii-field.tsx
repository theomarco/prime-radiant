"use client";

import { useEffect, useRef } from "react";

/**
 * Rows arrive unknown on the right, stream left, and leave answered.
 *
 * The important decomposition: a column's *identity* travels with the data
 * its confidence, its threshold, its noise. Whether it counts as
 * answered depends only on where it currently is. So nothing about the
 * transition moves; the data moves through it.
 *
 * There is no edge. Each cell carries its own threshold, so it flips somewhere
 * slightly different and certainty accumulates leftward instead of switching at
 * a line. That is also the honest picture: the model is surer about some rows
 * than others, and a hard boundary would imply a cutoff the product does not
 * have.
 *
 * Runs off React state on purpose, reconciling a few thousand glyphs per frame
 * would cost more than the animation is worth. The loop writes one HTML string,
 * with runs of a single colour collapsed into one span.
 */
const NOISE = "·:-=+*";
const SOLID = "▖▘▝▗▚▞▓█";
const COOL = ["--seq-1", "--seq-2", "--seq-3", "--seq-4"];
const WARM = ["--warm-1", "--warm-2", "--warm-3", "--warm-4"];

/**
 * Where certainty accumulates, left to right. A transition 0.26 wide centred at
 * 0.52, wide enough to read as a zone where cells are being decided, narrow
 * enough that both ends stay decisively answered and unknown. A hard edge read
 * as a loading bar; the full-width gradient lost "answered" as a distinct state.
 */
const GRADIENT_FROM = 0.39;
const GRADIENT_TO = 0.65;
/** Resolving fringe either side of a cell's flip point, scaled to that width. */
const FRINGE = 0.073;
/** Data buffer, wider than any viewport's column count. */
const BUFFER = 600;
/** Columns of bleed either side, hidden by the container, so the slide has
 *  something to slide in from. */
const BLEED = 2;
/** Columns per second. */
const SPEED = 4;

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function AsciiField({ rows = 22, className = "" }: { rows?: number; className?: string }) {
  const ref = useRef<HTMLPreElement>(null);
  const readout = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const pre = ref.current;
    if (!pre) return;

    const style = getComputedStyle(document.documentElement);
    const tone = (name: string) => style.getPropertyValue(name).trim() || "#888";
    const cool = COOL.map(tone);
    const warm = WARM.map(tone);

    const narrow = innerWidth < 640;
    const columns = () =>
      Math.max(24, Math.min(narrow ? 34 : 62, Math.floor(innerWidth / (narrow ? 14 : 22))));

    let C = columns();
    const rand = () => new Float32Array(BUFFER * rows).map(() => Math.random());
    let confidence = new Float32Array(BUFFER * rows).map(() => 0.35 + Math.random() * 0.65);
    let threshold = rand();
    let noise = rand();

    let offset = 0;
    let lastShift = -1;
    let t = 0;
    let visible = true;
    let raf = 0;
    let previous = 0;
    let lastRate = 0;

    // Measure one character's advance so the fractional slide is exact. The
    // probe copies the pre's resolved font and letter-spacing rather than its
    // classes, which carry layout too.
    const charWidth = () => {
      const cs = getComputedStyle(pre);
      const probe = document.createElement("span");
      probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre";
      probe.style.font = cs.font;
      probe.style.letterSpacing = cs.letterSpacing;
      probe.textContent = "0".repeat(100);
      pre.parentElement?.appendChild(probe);
      const w = probe.getBoundingClientRect().width / 100;
      probe.remove();
      return w || 7;
    };
    let ch = charWidth();

    const paint = (shift: number) => {
      let html = "";
      for (let y = 0; y < rows; y++) {
        let run = "";
        let runTone = "";
        for (let x = -BLEED; x < C + BLEED; x++) {
          const di = (((x + shift) % BUFFER) + BUFFER) % BUFFER;
          const i = y * BUFFER + di;
          const u = Math.min(1, Math.max(0, x / (C - 1))); // 0 at the left, 1 at the right
          // chance this column has been answered by the time it reaches x
          const p = 1 - smoothstep(GRADIENT_FROM, GRADIENT_TO, u);
          const th = threshold[i];
          const c = confidence[i];

          let glyph: string;
          let col: string;
          if (th < p - FRINGE) {
            // answered: glyph from confidence alone, so it travels without flickering
            col = warm[Math.min(3, Math.floor(c * 4))];
            glyph = SOLID[Math.min(SOLID.length - 1, Math.floor(c * SOLID.length))];
          } else if (th < p + FRINGE) {
            col = cool[3];
            glyph = SOLID[(Math.random() * SOLID.length) | 0];
          } else {
            col = cool[Math.min(3, Math.floor((1 - u) * 3.2))];
            glyph = NOISE[Math.min(NOISE.length - 1, Math.floor(noise[i] * NOISE.length))];
          }

          if (col === runTone) run += glyph;
          else {
            if (run) html += `<span style="color:${runTone}">${run}</span>`;
            run = glyph;
            runTone = col;
          }
        }
        if (run) html += `<span style="color:${runTone}">${run}</span>`;
        html += "\n";
      }
      pre.innerHTML = html;

      // re-roll the column about to enter, so the stream never loops
      const entering = (((C + BLEED + shift) % BUFFER) + BUFFER) % BUFFER;
      for (let y = 0; y < rows; y++) {
        const i = y * BUFFER + entering;
        confidence[i] = 0.35 + Math.random() * 0.65;
        threshold[i] = Math.random();
        noise[i] = Math.random();
      }
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!visible || document.hidden) {
        previous = now;
        return;
      }
      const dt = previous ? Math.min(0.1, (now - previous) / 1000) : 0;
      previous = now;
      offset += dt * SPEED;
      t += dt;

      // Whole columns are re-rendered; the fraction rides on a transform, so
      // motion is continuous instead of jumping a column every other frame.
      const shift = Math.floor(offset);
      if (shift !== lastShift) {
        paint(shift);
        lastShift = shift;
      }
      pre.style.transform = `translate3d(${-((offset - shift) + BLEED) * ch}px,0,0)`;

      // Four times a second is plenty for a number that moves by a digit or
      // two. Rewriting it every frame was pure waste.
      if (readout.current && now - lastRate > 250) {
        lastRate = now;
        // Anchored to the run measured on this site (2,000 rows in 2.7s),
        // drifting in a narrow band. An instrument, not a live meter.
        const rate = 740 + Math.sin(t * 0.55) * 55 + Math.sin(t * 2.1) * 22;
        readout.current.textContent = `${Math.round(rate).toLocaleString("en")} rows/s`;
      }
    };

    const onResize = () => {
      C = columns();
      ch = charWidth();
      lastShift = -1;
    };

    // Reduced motion gets one composed frame. The gradient is static by design,
    // so a single frame is the whole picture rather than a broken one.
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      paint(0);
      pre.style.transform = `translate3d(${-BLEED * ch}px,0,0)`;
      return;
    }

    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting), { threshold: 0.05 });
    io.observe(pre);
    addEventListener("resize", onResize);
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      removeEventListener("resize", onResize);
    };
  }, [rows]);

  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-4 border-b border-line px-1 pb-3">
        <span className="eyebrow truncate">answering continuously</span>
        {/* Fixed width, tabular figures, no wrapping: this string changes every
            frame, and an intrinsically-sized cell would resize the grid column
            and reflow the copy beside it on every tick. */}
        <span
          ref={readout}
          className="eyebrow shrink-0 text-right whitespace-nowrap tabular-nums"
          style={{ width: "12ch" }}
        >
          740 rows/s
        </span>
      </div>
      <div className="mt-4 w-full min-w-0 overflow-hidden">
        <pre
          ref={ref}
          aria-hidden="true"
          className="font-mono text-[11px] leading-[1.12] tracking-[1.4px] select-none will-change-transform sm:text-[12px]"
        />
      </div>
      <div className="mt-4 flex items-center gap-2.5 border-t border-line pt-3">
        <span className="eyebrow">answered</span>
        <span className="flex gap-[2px]" aria-hidden="true">
          {[...WARM].reverse().concat([...COOL].reverse()).map((v) => (
            <span key={v} className="block h-[7px] w-4 rounded-[2px]" style={{ background: `var(${v})` }} />
          ))}
        </span>
        <span className="eyebrow">unknown</span>
      </div>
    </div>
  );
}
