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
  const email = (data.user.email ?? "").toLowerCase();
  let digits = (data.user.phone ?? "").replace(/\D/g, "");
  // Toolkit logins are named after the mobile: hub-<9 digits>@staff.amatoolkit.local (0432 917 313 -> hub-432917313).
  const hub = email.match(/^hub-(\d{9})@staff\.amatoolkit\.local$/);
  if (!digits && hub) digits = "61" + hub[1];
  return { id: data.user.id, email: hub ? "" : email, digits };
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

const SECOND_STEP = ["owner", "full", "admin"];
export type Staff = { name: string; role: string; email: string; first: string; login: string };
/** Signed-in, active, preview staff only; owners/full/admins must have done their second step. Returns staff or an error. */
export async function requireStaff(req: Request): Promise<{ staff?: Staff; error?: string; status?: number }> {
  const auth = req.headers.get("authorization") ?? "";
  const u = await getUser(auth);
  if (!u) return { error: "Please sign in again.", status: 401 };
  const rows = await sql`select name, role, preview, email from ama_os.staff
    where active and ((${u.digits} <> '' and regexp_replace(coalesce(phone, ''), '\\D', '', 'g') = ${u.digits})
                      or (${u.email} <> '' and email = ${u.email}))
    order by (role = 'full') desc, preview desc limit 1`;
  if (!rows.length || !rows[0].preview) return { error: "Not allowed.", status: 403 };
  const s = rows[0];
  if (SECOND_STEP.includes(s.role) && String(claims(auth).aal ?? "aal1") !== "aal2" && !(await hasStepUp(req, u.id))) return { error: "Confirm it's you first.", status: 403 };
  return { staff: { name: s.name, role: s.role, email: s.email, first: String(s.name).trim().split(/\s+/)[0].toLowerCase(), login: u.digits || u.email } };
}
