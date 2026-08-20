import { NextResponse } from "next/server";
import { serviceClient, UPLOAD_BUCKET } from "@/lib/supabase";

/**
 * Reclaims storage. Two kinds of job leak space: ones that finished (their
 * predictions CSV is still around for the download link) and ones that were
 * uploaded and then abandoned before inference ever ran. Both are swept once a
 * day, after which `live_storage_bytes()` drops and uploads open back up.
 *
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET` when that env var is
 * set; anything else is refused so this cannot be triggered from outside.
 */
const RESULT_RETENTION_HOURS = 24;
/** A file uploaded and never predicted is dead weight, and at 50 MB a few of
 *  them would exhaust the storage budget long before a daily sweep. */
const ABANDONED_RETENTION_HOURS = 1;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Not authorised." }, { status: 401 });
    }
  }

  const db = serviceClient();
  const hours = (n: number) => new Date(Date.now() - n * 60 * 60 * 1000).toISOString();

  const [finished, abandoned] = await Promise.all([
    db
      .from("jobs")
      .select("id,storage_path,result_path")
      .is("cleaned_at", null)
      .in("status", ["done", "error"])
      .lt("created_at", hours(RESULT_RETENTION_HOURS))
      .limit(500),
    db
      .from("jobs")
      .select("id,storage_path,result_path")
      .is("cleaned_at", null)
      .in("status", ["awaiting_upload", "uploaded", "inspected", "running"])
      .lt("created_at", hours(ABANDONED_RETENTION_HOURS))
      .limit(500),
  ]);
  const error = finished.error ?? abandoned.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const stale = [...(finished.data ?? []), ...(abandoned.data ?? [])];
  if (!stale.length) return NextResponse.json({ swept: 0, objectsRemoved: 0 });

  const paths = stale.flatMap((job) =>
    [job.storage_path, job.result_path].filter((p): p is string => Boolean(p)),
  );
  if (paths.length) {
    const { error: removeError } = await db.storage.from(UPLOAD_BUCKET).remove(paths);
    // A missing object is the desired end state, so a partial failure here is
    // not fatal, but do not mark the jobs clean if the call failed outright.
    if (removeError) {
      return NextResponse.json({ error: removeError.message }, { status: 500 });
    }
  }

  const { error: markError } = await db
    .from("jobs")
    .update({ cleaned_at: new Date().toISOString(), size_bytes: 0, result_bytes: 0 })
    .in("id", stale.map((job) => job.id));
  if (markError) return NextResponse.json({ error: markError.message }, { status: 500 });

  return NextResponse.json({
    swept: stale.length,
    finished: finished.data?.length ?? 0,
    abandoned: abandoned.data?.length ?? 0,
    objectsRemoved: paths.length,
  });
}
