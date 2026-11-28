// amaos-camphelp: holiday-camp helper availability.
// Public (no sign-in): a helper opens their personal link (#<token>) or the shared link, searches their
//   own name, and ticks the camp slots they can help at. Staff (signed-in) open slots, see the roster and
//   manage the helper list. Uses the ama_os_app login only; the public never touches the tables directly.
// Deployed with --no-verify-jwt (public actions carry no bearer); staff actions still require a real sign-in.
import { cors, requireStaff, sql } from "../_shared/amaos.ts";

function newToken(): string {
  const b = new Uint8Array(18); crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const slotView = (r: Record<string, unknown>) => ({
  slot_id: r.slot_id, slot_date: r.slot_date, session: r.session, location: r.location,
  label: r.label, cap: Number(r.cap), count: Number(r.count ?? 0),
});

async function helperByToken(token: string) {
  if (!token) return null;
  const r = await sql`select helper_id, full_name from ama_os.camp_helpers where token = ${token} and active`;
  return r.length ? r[0] : null;
}

Deno.serve(async (req) => {
  const c = cors(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: c.headers });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...c.headers, "content-type": "application/json" } });
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const act = String(body.act ?? "");

    // ---- open slots + a helper's own picks (public: personal token) ----
    if (act === "me") {
      const h = await helperByToken(String(body.token ?? ""));
      if (!h) return json({ ok: false, error: "This link isn't valid. Ask for a new one." }, 403);
      const slots = await sql`
        select s.slot_id, s.slot_date, s.session, s.location, s.label, s.cap,
               (select count(*) from ama_os.camp_helper_signups g where g.slot_id = s.slot_id) as count,
               exists(select 1 from ama_os.camp_helper_signups g where g.slot_id = s.slot_id and g.helper_id = ${h.helper_id}) as booked
        from ama_os.camp_helper_slots s where s.is_open order by s.sort, s.slot_date, s.session`;
      return json({ ok: true, name: h.full_name, slots: slots.map((r) => ({ ...slotView(r), booked: r.booked })) });
    }

    // ---- shared link: search your own name, then get your token ----
    if (act === "find") {
      const q = String(body.q ?? "").trim();
      if (q.length < 2) return json({ ok: true, list: [] });
      const rows = await sql`select helper_id, full_name from ama_os.camp_helpers
        where active and is_extra and full_name ilike ${"%" + q + "%"} order by full_name limit 12`;
      return json({ ok: true, list: rows });
    }
    if (act === "link") {
      const r = await sql`select token from ama_os.camp_helpers where helper_id = ${String(body.helper_id ?? "")} and active`;
      return r.length ? json({ ok: true, token: r[0].token }) : json({ ok: false, error: "Not found." }, 404);
    }

    // ---- book / unbook a slot (public: personal token) ----
    if (act === "book" || act === "unbook") {
      const h = await helperByToken(String(body.token ?? ""));
      if (!h) return json({ ok: false, error: "This link isn't valid. Ask for a new one." }, 403);
      const slotId = String(body.slot_id ?? "");
      if (act === "unbook") {
        await sql`delete from ama_os.camp_helper_signups where helper_id = ${h.helper_id} and slot_id = ${slotId}`;
        return json({ ok: true });
      }
      // book: only if the slot is open and still under cap (and not already booked)
      const ins = await sql`
        insert into ama_os.camp_helper_signups (helper_id, slot_id)
        select ${h.helper_id}, s.slot_id from ama_os.camp_helper_slots s
        where s.slot_id = ${slotId} and s.is_open
          and (select count(*) from ama_os.camp_helper_signups g where g.slot_id = s.slot_id) < s.cap
        on conflict do nothing returning helper_id`;
      if (!ins.length) {
        const already = await sql`select 1 from ama_os.camp_helper_signups where helper_id = ${h.helper_id} and slot_id = ${slotId}`;
        if (already.length) return json({ ok: true });
        return json({ ok: false, error: "That slot is full or closed." }, 409);
      }
      return json({ ok: true });
    }

    // ================= staff (signed in) =================
    const g = await requireStaff(req);
    if (!g.staff) return json({ ok: false, error: g.error }, g.status ?? 403);

    if (act === "admin_slots") {
      const rows = await sql`select s.*, (select count(*) from ama_os.camp_helper_signups g where g.slot_id = s.slot_id) as count
        from ama_os.camp_helper_slots s order by s.sort, s.slot_date, s.session`;
      return json({ ok: true, slots: rows.map((r) => ({ ...slotView(r), is_open: r.is_open, sort: Number(r.sort) })) });
    }
    if (act === "admin_slot_set") {
      const id = String(body.slot_id ?? "");
      const date = String(body.slot_date ?? ""), sess = String(body.session ?? "all") || "all";
      const loc = String(body.location ?? "") || null, label = String(body.label ?? "") || null;
      const cap = Math.max(1, Math.min(99, Number(body.cap ?? 6) | 0));
      const open = body.is_open === undefined ? true : !!body.is_open, sort = Number(body.sort ?? 0) | 0;
      if (id) {
        await sql`update ama_os.camp_helper_slots set slot_date=${date}, session=${sess}, location=${loc}, label=${label}, cap=${cap}, is_open=${open}, sort=${sort} where slot_id=${id}`;
        return json({ ok: true, slot_id: id });
      }
      if (!date) return json({ ok: false, error: "Pick a date." }, 400);
      const r = await sql`insert into ama_os.camp_helper_slots (slot_date, session, location, label, cap, is_open, sort)
        values (${date}, ${sess}, ${loc}, ${label}, ${cap}, ${open}, ${sort}) returning slot_id`;
      return json({ ok: true, slot_id: r[0].slot_id });
    }
    if (act === "admin_slot_del") {
      await sql`delete from ama_os.camp_helper_slots where slot_id = ${String(body.slot_id ?? "")}`;
      return json({ ok: true });
    }
    if (act === "admin_roster") {
      const rows = await sql`
        select s.slot_id, s.slot_date, s.session, s.location, s.label, s.cap,
               coalesce(json_agg(json_build_object('helper_id', h.helper_id, 'name', h.full_name) order by h.full_name)
                        filter (where h.helper_id is not null), '[]') as helpers
        from ama_os.camp_helper_slots s
        left join ama_os.camp_helper_signups g on g.slot_id = s.slot_id
        left join ama_os.camp_helpers h on h.helper_id = g.helper_id
        group by s.slot_id order by s.sort, s.slot_date, s.session`;
      return json({ ok: true, roster: rows });
    }
    if (act === "admin_helpers") {
      const rows = await sql`select helper_id, full_name, mobile, email, active, is_extra, token, invited_at,
          (select count(*) from ama_os.camp_helper_signups g where g.helper_id = camp_helpers.helper_id) as slots
        from ama_os.camp_helpers order by active desc, full_name`;
      return json({ ok: true, helpers: rows });
    }
    if (act === "admin_helper_set") {
      const id = String(body.helper_id ?? ""), name = String(body.full_name ?? "").trim();
      const mobile = String(body.mobile ?? "") || null, email = String(body.email ?? "") || null;
      const active = body.active === undefined ? true : !!body.active;
      const isExtra = body.is_extra === undefined ? true : !!body.is_extra;
      if (id) {
        await sql`update ama_os.camp_helpers set full_name=${name}, mobile=${mobile}, email=${email}, active=${active}, is_extra=${isExtra} where helper_id=${id}`;
        return json({ ok: true, helper_id: id });
      }
      if (!name) return json({ ok: false, error: "Name is required." }, 400);
      const r = await sql`insert into ama_os.camp_helpers (full_name, token, mobile, email, active, is_extra)
        values (${name}, ${newToken()}, ${mobile}, ${email}, ${active}, ${isExtra}) returning helper_id, token`;
      return json({ ok: true, helper_id: r[0].helper_id, token: r[0].token });
    }
    if (act === "admin_helper_del") {
      await sql`delete from ama_os.camp_helpers where helper_id = ${String(body.helper_id ?? "")}`;
      return json({ ok: true });
    }

    return json({ ok: false, error: "Unknown action." }, 400);
  } catch (e) {
    return json({ ok: false, error: "Something went wrong. Please try again.", detail: String((e as Error).message ?? e).slice(0, 200) }, 500);
  }
});
