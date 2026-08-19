import { NextResponse } from "next/server";
import { identityHash } from "@/lib/identity";
import { serviceClient } from "@/lib/supabase";

const MAX_LEN = 500;
const MIN_LEN = 3;
const IDEAS_PER_DAY = 5;

export type Idea = {
  id: string;
  created_at: string;
  what_to_predict: string;
  what_for: string;
  vote_count: number;
  voted: boolean;
};

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/** The board. `sort=new` for reverse-chronological, default is most-wanted. */
export async function GET(request: Request) {
  const sort = new URL(request.url).searchParams.get("sort") === "new" ? "new" : "top";
  const db = serviceClient();
  const ipHash = await identityHash();

  const query = db
    .from("ideas")
    .select("id,created_at,what_to_predict,what_for,vote_count")
    .eq("hidden", false)
    .limit(200);

  const { data, error } =
    sort === "new"
      ? await query.order("created_at", { ascending: false })
      : await query.order("vote_count", { ascending: false }).order("created_at", { ascending: false });

  if (error) return bad(error.message, 500);

  const ids = (data ?? []).map((d) => d.id);
  const { data: mine } = ids.length
    ? await db.from("idea_votes").select("idea_id").eq("ip_hash", ipHash).in("idea_id", ids)
    : { data: [] as { idea_id: string }[] };
  const voted = new Set((mine ?? []).map((v) => v.idea_id));

  const ideas: Idea[] = (data ?? []).map((d) => ({ ...d, voted: voted.has(d.id) }));
  return NextResponse.json({ ideas });
}

export async function POST(request: Request) {
  let body: { whatToPredict?: unknown; whatFor?: unknown };
  try {
    body = await request.json();
  } catch {
    return bad("Expected a JSON body.");
  }

  const whatToPredict = typeof body.whatToPredict === "string" ? body.whatToPredict.trim() : "";
  const whatFor = typeof body.whatFor === "string" ? body.whatFor.trim() : "";

  if (whatToPredict.length < MIN_LEN) return bad("Tell us what you'd want to predict.");
  if (whatFor.length < MIN_LEN) return bad("Tell us what you'd do with it.");
  if (whatToPredict.length > MAX_LEN || whatFor.length > MAX_LEN) {
    return bad(`Keep each answer under ${MAX_LEN} characters.`);
  }

  const db = serviceClient();
  const ipHash = await identityHash();

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await db
    .from("ideas")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("created_at", since);
  if ((count ?? 0) >= IDEAS_PER_DAY) {
    return bad("That's a lot of ideas for one day. Come back tomorrow.", 429);
  }

  const { data, error } = await db
    .from("ideas")
    .insert({ ip_hash: ipHash, what_to_predict: whatToPredict, what_for: whatFor })
    .select("id,created_at,what_to_predict,what_for,vote_count")
    .single();
  if (error) return bad(error.message, 500);

  // Posting an idea implies wanting it.
  await db.from("idea_votes").insert({ idea_id: data.id, ip_hash: ipHash });

  return NextResponse.json({ idea: { ...data, vote_count: 1, voted: true } satisfies Idea });
}
