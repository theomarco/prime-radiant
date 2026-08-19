import { NextResponse } from "next/server";
import { identityHash } from "@/lib/identity";
import { serviceClient } from "@/lib/supabase";

/** Toggle a vote. One per idea per identity, enforced by the composite PK. */
export async function POST(request: Request) {
  let body: { id?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "Missing id." }, { status: 400 });

  const db = serviceClient();
  const ipHash = await identityHash();

  const { data: existing } = await db
    .from("idea_votes")
    .select("idea_id")
    .eq("idea_id", id)
    .eq("ip_hash", ipHash)
    .maybeSingle();

  if (existing) {
    await db.from("idea_votes").delete().eq("idea_id", id).eq("ip_hash", ipHash);
  } else {
    const { error } = await db.from("idea_votes").insert({ idea_id: id, ip_hash: ipHash });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const { data: idea } = await db.from("ideas").select("vote_count").eq("id", id).maybeSingle();
  return NextResponse.json({ voteCount: idea?.vote_count ?? 0, voted: !existing });
}
