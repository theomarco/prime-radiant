"use client";

import { useEffect, useRef } from "react";

/**
 * The field is the claim, not decoration: a wave sweeps across a grid of cells
 * and leaves answers behind it. Hue carries state — cool for a cell we know
 * nothing about, the accent once it has been answered — and lightness carries
 * how sure the answer is.
 *
 * Runs off React state on purpose. Reconciling a few thousand glyphs per frame
 * would cost more than the animation is worth, so the loop writes one HTML
 * string, with runs of a single colour collapsed into one span.
 */
const NOISE = "·:-=+*";
const SOLID = "▖▘▝▗▚▞▓█";
const COOL = ["--seq-1", "--seq-2", "--seq-3", "--seq-4"];
const WARM = ["--warm-1", "--warm-2", "--warm-3", "--warm-4"];

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

    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const narrow = innerWidth < 640;
    const cols = () => Math.max(24, Math.min(narrow ? 34 : 62, Math.floor(innerWidth / (narrow ? 14 : 22))));

    let C = cols();
    let confidence = new Float32Array(C * rows).map(() => 0.35 + Math.random() * 0.65);
    let t = 0;
    let visible = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    // The band wraps on the column count, so the answer front rotates through
    // for ever instead of filling up and starting over. Nothing resets, which
    // is what a process that never stops should look like.
    const BAND = 0.72;

    const paint = () => {
      const front = (t * 0.55) % C;
      let html = "";
      for (let y = 0; y < rows; y++) {
        let run = "";
        let runTone = "";
        for (let x = 0; x < C; x++) {
          // circular distance behind the front, so the seam never shows
          const raw = front + Math.sin(y * 1.7 + x * 0.3) * 2.2 - x;
          const d = ((raw % C) + C) % C;
          const behind = d < C * BAND;
          const c = confidence[y * C + x] ?? 0.6;
          let ch: string;
          let col: string;
          if (behind && d > 2.5) {
            col = warm[Math.min(3, Math.floor(c * 4))];
            ch = SOLID[Math.min(SOLID.length - 1, Math.floor(c * SOLID.length))];
          } else if (d <= 2.5 || d > C - 2.5) {
            col = cool[3];
            ch = SOLID[(Math.random() * SOLID.length) | 0];
          } else {
            const v = (Math.sin(x * 0.42 + t * 0.1) + Math.sin(y * 0.5 - t * 0.07) + 2) / 4;
            col = cool[Math.min(3, Math.floor(v * 3))];
            ch = NOISE[Math.min(NOISE.length - 1, Math.floor(v * NOISE.length))];
          }
          // collapse consecutive same-colour glyphs into one span
          if (col === runTone) run += ch;
          else {
            if (run) html += `<span style="color:${runTone}">${run}</span>`;
            run = ch;
            runTone = col;
          }
        }
        if (run) html += `<span style="color:${runTone}">${run}</span>`;
        html += "\n";
      }
      pre.innerHTML = html;
      if (readout.current) {
        // Anchored to the measured run on this site — 2,000 rows in 2.7s —
        // drifting inside a narrow band so it reads as a live instrument
        // rather than a fixed label.
        const rate = 740 + Math.sin(t * 0.06) * 55 + Math.sin(t * 0.23) * 22;
        readout.current.textContent = `${Math.round(rate).toLocaleString("en")} rows/s`;
      }
      // cells re-roll as the front passes them, so confidence keeps moving
      const edge = Math.floor(front);
      for (let y = 0; y < rows; y++) {
        const i = y * C + ((edge + 3) % C);
        confidence[i] = 0.35 + Math.random() * 0.65;
      }
    };

    const loop = () => {
      if (visible && !document.hidden) {
        t += 1;
        paint();
      }
      timer = setTimeout(loop, 70);
    };

    const onResize = () => {
      C = cols();
      confidence = new Float32Array(C * rows).map(() => 0.35 + Math.random() * 0.65);
    };

    // Reduced motion gets one composed frame and nothing else.
    if (reduced) {
      t = 40;
      paint();
      return;
    }

    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting), { threshold: 0.05 });
    io.observe(pre);
    addEventListener("resize", onResize);
    loop();
    return () => {
      if (timer) clearTimeout(timer);
      io.disconnect();
      removeEventListener("resize", onResize);
    };
  }, [rows]);

  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-4 border-b border-line px-1 pb-3">
        <span className="eyebrow truncate">answering continuously</span>
        {/* Fixed width and tabular figures: this string changes every frame, and
            an intrinsically-sized cell would resize the grid column and reflow
            the copy beside it on every tick. */}
        <span
          ref={readout}
          className="eyebrow shrink-0 text-right whitespace-nowrap tabular-nums"
          style={{ width: "12ch" }}
        >
          740 rows/s
        </span>
      </div>
      <pre
        ref={ref}
        aria-hidden="true"
        className="mt-4 w-full min-w-0 overflow-hidden font-mono text-[11px] leading-[1.12] tracking-[1.4px] select-none sm:text-[12px]"
      />
      <div className="mt-4 flex items-center gap-2.5 border-t border-line pt-3">
        <span className="eyebrow">unknown</span>
        <span className="flex gap-[2px]" aria-hidden="true">
          {[...COOL, ...WARM].map((v) => (
            <span
              key={v}
              className="block h-[7px] w-4 rounded-[2px]"
              style={{ background: `var(${v})` }}
            />
          ))}
        </span>
        <span className="eyebrow">answered, and how sure</span>
      </div>
    </div>
  );
}
