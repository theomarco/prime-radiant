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
  const counter = useRef<HTMLSpanElement>(null);

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

    const paint = () => {
      const front = ((t * 0.55) % (C + 26)) - 8;
      let html = "";
      for (let y = 0; y < rows; y++) {
        let run = "";
        let runTone = "";
        for (let x = 0; x < C; x++) {
          const d = front + Math.sin(y * 1.7 + x * 0.3) * 2.2 - x;
          const c = confidence[y * C + x] ?? 0.6;
          let ch: string;
          let col: string;
          if (d > 2.5) {
            col = warm[Math.min(3, Math.floor(c * 4))];
            ch = SOLID[Math.min(SOLID.length - 1, Math.floor(c * SOLID.length))];
          } else if (d > -2.5) {
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
      if (counter.current) {
        const done = Math.max(0, Math.min(1, front / C));
        counter.current.textContent =
          done >= 1 ? "8,000 answered" : `${Math.round(done * 8000).toLocaleString("en")} answered`;
      }
      if (front > C + 16) {
        confidence = new Float32Array(C * rows).map(() => 0.35 + Math.random() * 0.65);
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
      <div className="flex items-baseline justify-between border-b border-line px-1 pb-3">
        <span className="eyebrow">8,000 rows · one empty column</span>
        <span className="eyebrow" ref={counter}>
          reading
        </span>
      </div>
      <pre
        ref={ref}
        aria-hidden="true"
        className="mt-4 overflow-hidden font-mono text-[11px] leading-[1.12] tracking-[1.4px] select-none sm:text-[12px]"
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
