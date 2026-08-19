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
const RETENTION_HOURS = 24;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Not authorised." }, { status: 401 });
    }
  }

  const db = serviceClient();
  const cutoff = new Date(Date.now() - RETENTION_HOURS * 60 * 60 * 1000).toISOString();

  const { data: stale, error } = await db
    .from("jobs")
    .select("id,storage_path,result_path")
    .is("cleaned_at", null)
    .lt("created_at", cutoff)
    .limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!stale?.length) return NextResponse.json({ swept: 0, bytesFreed: 0 });

  const paths = stale.flatMap((job) =>
    [job.storage_path, job.result_path].filter((p): p is string => Boolean(p)),
  );
  if (paths.length) {
    const { error: removeError } = await db.storage.from(UPLOAD_BUCKET).remove(paths);
    // A missing object is the desired end state, so a partial failure here is
    // not fatal — but do not mark the jobs clean if the call failed outright.
    if (removeError) {
      return NextResponse.json({ error: removeError.message }, { status: 500 });
    }
  }

  const { error: markError } = await db
    .from("jobs")
    .update({ cleaned_at: new Date().toISOString(), size_bytes: 0, result_bytes: 0 })
    .in("id", stale.map((job) => job.id));
  if (markError) return NextResponse.json({ error: markError.message }, { status: 500 });

  return NextResponse.json({ swept: stale.length, objectsRemoved: paths.length });
}
