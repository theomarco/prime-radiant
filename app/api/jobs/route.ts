import { NextResponse } from "next/server";
import { identityHash } from "@/lib/identity";
import { serviceClient, UPLOAD_BUCKET } from "@/lib/supabase";
import {
  GLOBAL_STORAGE_BYTES,
  MAX_FILE_BYTES,
  UPLOADS_PER_DAY,
  extensionOf,
  isAcceptedFile,
} from "@/lib/limits";

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/** Create a job row and hand back a signed URL so the file goes straight to
 *  Storage — it never passes through a Vercel function. */
export async function POST(request: Request) {
  let body: { filename?: unknown; size?: unknown };
  try {
    body = await request.json();
  } catch {
    return bad("Expected a JSON body.");
  }

  const filename = typeof body.filename === "string" ? body.filename.trim() : "";
  const size = typeof body.size === "number" ? body.size : NaN;

  if (!filename) return bad("Missing filename.");
  if (!isAcceptedFile(filename)) return bad("Only .csv and .parquet files are accepted.");
  if (!Number.isFinite(size) || size <= 0) return bad("Missing or invalid file size.");
  if (size > MAX_FILE_BYTES) {
    return bad(`That file is ${(size / 1048576).toFixed(1)} MB. The limit is 10 MB.`, 413);
  }

  const db = serviceClient();
  const ipHash = await identityHash();

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error: countError } = await db
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("created_at", since);
  if (countError) return bad(countError.message, 500);
  if ((count ?? 0) >= UPLOADS_PER_DAY) {
    return bad(
      `That's ${UPLOADS_PER_DAY} predictions in 24 hours — the daily limit. Try again tomorrow.`,
      429,
    );
  }

  const { data: used, error: usedError } = await db.rpc("live_storage_bytes");
  if (usedError) return bad(usedError.message, 500);
  if (Number(used ?? 0) + size > GLOBAL_STORAGE_BYTES) {
    return bad("Storage is full right now. Files clear within 24 hours — try again shortly.", 503);
  }

  const { data: job, error: insertError } = await db
    .from("jobs")
    .insert({ ip_hash: ipHash, filename, size_bytes: size, storage_path: "" })
    .select("id")
    .single();
  if (insertError || !job) return bad(insertError?.message ?? "Could not create job.", 500);

  const storagePath = `${job.id}/source${extensionOf(filename)}`;
  const { data: signed, error: signError } = await db.storage
    .from(UPLOAD_BUCKET)
    .createSignedUploadUrl(storagePath);
  if (signError || !signed) {
    await db.from("jobs").update({ status: "error", error: signError?.message }).eq("id", job.id);
    return bad(signError?.message ?? "Could not create upload URL.", 500);
  }

  await db.from("jobs").update({ storage_path: storagePath }).eq("id", job.id);

  return NextResponse.json({ jobId: job.id, uploadUrl: signed.signedUrl, path: storagePath });
}

/** Poll a job. Scoped to the caller's identity so job ids aren't enumerable. */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return bad("Missing id.");

  const db = serviceClient();
  const ipHash = await identityHash();
  const { data, error } = await db
    .from("jobs")
    .select("id,status,filename,n_rows,n_cols,col_meta,target,task_type,n_context,n_predicted,duration_ms,error")
    .eq("id", id)
    .eq("ip_hash", ipHash)
    .maybeSingle();

  if (error) return bad(error.message, 500);
  if (!data) return bad("Job not found.", 404);
  return NextResponse.json(data);
}
