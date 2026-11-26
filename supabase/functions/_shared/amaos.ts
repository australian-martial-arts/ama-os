// Shared helpers for AMA OS edge functions. Uses the ama_os_app database login only (never service role).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import postgres from "npm:postgres@3.4.4";

export const sql = postgres(Deno.env.get("AMA_OS_DB_URL") ?? "", { max: 1, prepare: false });
const ALLOWED = [/^https:\/\/ama-os\.train-ama\.com$/, /^https:\/\/([a-z0-9-]+\.)?ama-os\.pages\.dev$/];

export function cors(origin: string | null) {
  const ok = !!origin && ALLOWED.some((r) => r.test(origin));
  return {
    ok,
    headers: {
      "Access-Control-Allow-Origin": ok ? origin! : "https://ama-os.train-ama.com",
      "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-amaos-event, x-amaos-stepup",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Vary": "Origin",
    },
  };
}

export function claims(authHeader: string): Record<string, unknown> {
  try { const p = authHeader.replace(/^Bearer\s+/i, "").split(".")[1]; return JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/"))); }
  catch { return {}; }
}

export async function getUser(authHeader: string) {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
  const { data, error } = await sb.auth.getUser();
  if (error || !data?.user) return null;
  return { id: data.user.id, email: (data.user.email ?? "").toLowerCase(), digits: (data.user.phone ?? "").replace(/\D/g, "") };
}

export async function sha256(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** True if this request carries a valid confirmed second step (passkey) for this user. */
export async function hasStepUp(req: Request, userId: string) {
  const t = req.headers.get("x-amaos-stepup"); if (!t) return false;
  const rows = await sql`select 1 from ama_os.stepup where token_hash = ${await sha256(t)} and user_id = ${userId} and expires_at > now()`;
  return rows.length > 0;
}
