"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Scroll-entry wrapper. Transform + opacity only, IntersectionObserver only. */
export function Reveal({
  children,
  index = 0,
  className = "",
  as: Tag = "div",
}: {
  children: ReactNode;
  index?: number;
  className?: string;
  as?: "div" | "section" | "li" | "article";
}) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const show = () => node.classList.add("reveal-in");
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          show();
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.05 },
    );
    observer.observe(node);
    // Failsafe: nothing on this page should stay invisible because an observer
    // did not fire. Worst case the animation is skipped, not the content.
    const failsafe = setTimeout(() => {
      show();
      observer.disconnect();
    }, 1600);
    return () => {
      clearTimeout(failsafe);
      observer.disconnect();
    };
  }, []);

  return (
    <Tag
      ref={ref as never}
      className={`reveal ${className}`}
      style={{ "--index": index } as React.CSSProperties}
    >
      {children}
    </Tag>
  );
}
