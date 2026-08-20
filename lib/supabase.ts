import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

/**
 * Service-role client. Every table has RLS on with zero policies, so this is
 * the only way in, all access is mediated by our route handlers, which is
 * where rate limiting and identity hashing live.
 */
export function serviceClient(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY must be set");
  }
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

export const UPLOAD_BUCKET = "uploads";
