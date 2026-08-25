// Upload caps. Seldon is not the constraint: 227,845 context rows across 30
// features came back in 46 s, a 171 MB request. What binds is the memory and
// time of the function that parses the file and builds that request, and the
// storage a file occupies until it is swept.

export const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB

/* Two regimes, and they must not be confused.
 *
 * A file a visitor uploads is arbitrary and untrusted. It is capped on size,
 * rows and columns, rate limited per person per day, and counted against the
 * storage ceiling, because every one of those costs something we did not choose
 * to spend.
 *
 * A bundled sample is a file we prepared, checked and shipped. It already sits
 * on the CDN, it is never uploaded, it occupies no storage, and none of the
 * limits above apply to it. Anything guarding an upload should be behind an
 * `isBundledSample` check. */
export const BUNDLED_SAMPLES = new Set([
  "bank-churn.csv",
  "machine-failure.csv",
  "online-shoppers.csv",
  "credit-score.parquet",
  "card-fraud.parquet",
  "lead-scoring.csv",
  "hr-attrition.csv",
  "hotel-cancellations.parquet",
  "late-delivery.csv",
]);

export function isBundledSample(filename: string): boolean {
  return BUNDLED_SAMPLES.has(filename);
}

/** Public path of a bundled sample, which is also where the runtime reads it. */
export function samplePath(filename: string): string {
  return `/samples/${filename}`;
}
export const MAX_ROWS = 500_000;
export const MAX_COLS = 400;
export const UPLOADS_PER_DAY = 3;

/** Trip below the storage ceiling so uploads degrade gracefully rather than fail hard. */
export const GLOBAL_STORAGE_BYTES = 800 * 1024 * 1024;

export const ACCEPTED_EXTENSIONS = [".csv", ".parquet", ".pq"] as const;

export const LIMITS_COPY = {
  file: "50 MB",
  rows: "500,000 rows",
  cols: "400 columns",
  perDay: `${UPLOADS_PER_DAY} predictions per day`,
} as const;

export function extensionOf(filename: string): string {
  const i = filename.lastIndexOf(".");
  return i === -1 ? "" : filename.slice(i).toLowerCase();
}

export function isAcceptedFile(filename: string): boolean {
  return (ACCEPTED_EXTENSIONS as readonly string[]).includes(extensionOf(filename));
}
