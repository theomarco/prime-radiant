import type { Metadata } from "next";
import { PredictClient } from "./predict-client";

export const metadata: Metadata = {
  title: "Predict — Prime Radiant",
  description: "Upload a table, pick the column you want filled in, get predictions.",
};

export default function PredictPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 pt-20 pb-28">
      <p className="eyebrow mb-6">Predict</p>
      <h1 className="display max-w-2xl text-[2.5rem] sm:text-[3.25rem]">
        Bring a table. Leave with the column you were missing.
      </h1>
      <p className="mt-7 max-w-xl text-[1.0625rem] text-ink-soft">
        No training run, no feature engineering, no model to maintain. The rows you have
        already answered become the examples; the rows you have not become the output.
      </p>
      <div className="mt-14">
        <PredictClient />
      </div>
    </div>
  );
}
