import type { Metadata } from "next";
import { BoardClient } from "./board-client";

export const metadata: Metadata = {
  title: "The board — Prime Radiant",
  description:
    "Two questions: what do you want to predict, and what would you do with it. Vote on what gets built next.",
};

export default function BoardPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 pt-20 pb-28">
      <p className="eyebrow mb-6">The board</p>
      <h1 className="display max-w-2xl text-[2.5rem] sm:text-[3.25rem]">
        Every organization carries a thousand questions too small for a project.
      </h1>
      <p className="mt-7 max-w-xl text-[1.0625rem] text-ink-soft">
        This is where they go. Two questions, no account. What gets voted up is what gets
        built next.
      </p>
      <div className="mt-14">
        <BoardClient />
      </div>
    </div>
  );
}
