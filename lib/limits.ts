// Upload caps. Seldon requests are unmetered, so the binding constraints are
// storage and the function timeout — never API cost.

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_ROWS = 200_000;
export const MAX_COLS = 200;
export const UPLOADS_PER_DAY = 3;

/** Trip below the storage ceiling so uploads degrade gracefully rather than fail hard. */
export const GLOBAL_STORAGE_BYTES = 800 * 1024 * 1024;

export const ACCEPTED_EXTENSIONS = [".csv", ".parquet", ".pq"] as const;

export const LIMITS_COPY = {
  file: "10 MB",
  rows: "200,000 rows",
  cols: "200 columns",
  perDay: `${UPLOADS_PER_DAY} predictions per day`,
} as const;

export function extensionOf(filename: string): string {
  const i = filename.lastIndexOf(".");
  return i === -1 ? "" : filename.slice(i).toLowerCase();
}

export function isAcceptedFile(filename: string): boolean {
  return (ACCEPTED_EXTENSIONS as readonly string[]).includes(extensionOf(filename));
}
