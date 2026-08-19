import { createHash } from "node:crypto";
import { headers } from "next/headers";

/**
 * A stable, non-reversible handle for an anonymous visitor: salted hash of
 * IP + user-agent. Used to dedupe upvotes and to rate-limit uploads. We never
 * store the raw address.
 */
export async function identityHash(): Promise<string> {
  const h = await headers();
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "0.0.0.0";
  const ua = h.get("user-agent") ?? "";
  const salt = process.env.IDENTITY_SALT ?? "prime-radiant-dev-salt";
  return createHash("sha256").update(`${salt}|${ip}|${ua}`).digest("hex").slice(0, 32);
}
