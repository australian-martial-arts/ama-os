// amaos-me: who is signed in, and what can they see in AMA OS?
// Verifies the Supabase login, then looks the person up in ama_os.staff using the ama_os_app
// database login (AMA_OS_DB_URL). It never uses the service-role key, so it cannot see Toolkit tables.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import postgres from "npm:postgres@3.4.4";

const ALLOWED = [/^https:\/\/ama-os\.train-ama\.com$/, /^https:\/\/([a-z0-9-]+\.)?ama-os\.pages\.dev$/];
const sql = postgres(Deno.env.get("AMA_OS_DB_URL") ?? "", { max: 1, prepare: false });

function cors(origin: string | null) {
  const ok = origin && ALLOWED.some((r) => r.test(origin));
  return {
    "Access-Control-Allow-Origin": ok ? origin! : "https://ama-os.train-ama.com",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

Deno.serve(async (req) => {
  const h = cors(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...h, "content-type": "application/json" } });
  try {
    const auth = req.headers.get("authorization") ?? "";
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data, error } = await sb.auth.getUser();
    const email = data?.user?.email?.toLowerCase();
    if (error || !email) return json({ ok: false, error: "Please sign in again." }, 401);
    const rows = await sql`select name, role, preview from ama_os.staff where email = ${email} and active`;
    if (!rows.length) return json({ ok: false, error: "This email isn't set up for AMA OS yet." }, 403);
    const s = rows[0];
    if (!s.preview) return json({ ok: false, error: "AMA OS is coming soon." }, 403);
    return json({ ok: true, email, name: s.name, role: s.role });
  } catch (_e) {
    return json({ ok: false, error: "Something went wrong. Please try again." }, 500);
  }
});
