// amaos-me: who is signed in, and what can they see in AMA OS?
// Owners, full-access admins and admins must also confirm with a passkey or an authenticator app.
// Uses the ama_os_app database login only (never the service-role key), so it cannot see Toolkit tables.
import { claims, cors, getUser, hasStepUp, sql } from "../_shared/amaos.ts";

const SECOND_STEP_ROLES = ["owner", "full", "admin"];

Deno.serve(async (req) => {
  const c = cors(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: c.headers });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...c.headers, "content-type": "application/json" } });
  try {
    const auth = req.headers.get("authorization") ?? "";
    const u = await getUser(auth);
    if (!u) return json({ ok: false, error: "Please sign in again." }, 401);
    const rows = await sql`select name, role, preview, email from ama_os.staff
      where active and ((${u.digits} <> '' and regexp_replace(coalesce(phone, ''), '\\D', '', 'g') = ${u.digits})
                        or (${u.email} <> '' and email = ${u.email}))
      limit 1`;
    if (!rows.length) return json({ ok: false, error: "This login isn't set up for AMA OS yet (" + (u.email || "+" + u.digits) + ")." }, 403);
    const s = rows[0];
    if (!s.preview) return json({ ok: false, error: "AMA OS is coming soon." }, 403);

    const needs = SECOND_STEP_ROLES.includes(s.role);
    const aal = String(claims(auth).aal ?? "aal1");
    const passkey = needs && aal !== "aal2" ? await hasStepUp(req, u.id) : false;
    if (needs && aal !== "aal2" && !passkey) {
      const pk = await sql`select count(*)::int as n from ama_os.passkeys where user_id = ${u.id}`;
      return json({ ok: false, mfa: true, passkeys: pk[0].n, name: s.name, role: s.role, error: "Confirm it's you." }, 403);
    }
    if (req.headers.get("x-amaos-event") === "signin") {
      await sql`insert into ama_os.audit (actor, actor_login, role, action, detail)
        values (${s.name}, ${u.digits || u.email}, ${s.role}, 'signin',
                ${sql.json({ second_step: needs ? (aal === "aal2" ? "authenticator" : "passkey") : "none", ua: (req.headers.get("user-agent") ?? "").slice(0, 160) })})`;
    }
    return json({ ok: true, email: s.email, name: s.name, role: s.role, secondStep: needs });
  } catch (_e) {
    return json({ ok: false, error: "Something went wrong. Please try again." }, 500);
  }
});
