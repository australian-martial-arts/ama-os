// amaos-sync: receives the nightly read-only copy of the Apps Script hub sheets.
// Called by the hub (Apps Script), not by people, so it is checked with a shared sync key
// (AMAOS_SYNC_KEY, set by Tate in Supabase secrets and in the hub's script properties) instead of a sign-in.
// Uses the ama_os_app database login only. Never writes to the hub, EFC or GHL.
import { sha256, sql } from "../_shared/amaos.ts";

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
const SECRET = /pin|password|passcode|token|secret|api.?key|card|bsb|account.?number/i;
const FULL = ["mark", "sarah", "hakan", "ridvan"];
const PREVIEW = ["mark", "sarah", "hakan", "ridvan", "busra", "laurie", "bianca", "mady", "tate"];

function mapRole(name: string, hubRole: string) {
  const first = name.trim().split(/\s+/)[0].toLowerCase(), r = hubRole.toLowerCase();
  if (FULL.includes(first)) return "full";
  if (/market/.test(r)) return "marketing";
  if (/junior/.test(r)) return "junior";
  if (/admin|office|holds|reception|manag|head|owner/.test(r)) return "admin";
  return "instructor";
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "POST only." }, 405);
  const want = Deno.env.get("AMAOS_SYNC_KEY") ?? "";
  const got = req.headers.get("x-amaos-sync-key") ?? "";
  if (!want || !got || (await sha256(got)) !== (await sha256(want))) return json({ ok: false, error: "Not allowed." }, 401);
  try {
    const b = await req.json() as { source?: string; rows?: { key: string; data: Record<string, unknown> }[] };
    const source = String(b.source ?? "").slice(0, 80);
    const rows = Array.isArray(b.rows) ? b.rows.slice(0, 20000) : null;
    if (!source || !rows) return json({ ok: false, error: "Missing source or rows." }, 400);

    // Strip anything that looks like a secret, whatever the hub sends.
    const clean = rows.map((r) => {
      const d: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r.data ?? {})) if (!SECRET.test(k)) d[k] = v;
      return { key: String(r.key).slice(0, 200), data: d };
    });

    let staff = 0;
    await sql.begin(async (tx) => {
      await tx`delete from ama_os.mirror where source = ${source}`;
      for (let i = 0; i < clean.length; i += 500) {
        const part = clean.slice(i, i + 500).map((r) => ({ source, key: r.key, data: tx.json(r.data as never) }));
        await tx`insert into ama_os.mirror ${tx(part, "source", "key", "data")} on conflict (source, key) do update set data = excluded.data, synced_at = now()`;
      }
      if (source === "Hub staff") {
        const seen: string[] = [];
        for (const r of clean) {
          const name = String(r.data["Name"] ?? "").trim(), hubRole = String(r.data["Role"] ?? "").trim();
          const last9 = String(r.data["Mobile"] ?? "").replace(/\D/g, "").slice(-9);
          const active = r.data["Active"] === true || String(r.data["Active"]).toUpperCase() === "TRUE";
          if (!name || last9.length !== 9) continue;
          const digits = "61" + last9; seen.push(digits);
          const ex = await tx`select email from ama_os.staff where regexp_replace(coalesce(phone, ''), '\\D', '', 'g') = ${digits} limit 1`;
          if (ex.length) {
            await tx`update ama_os.staff set name = ${name}, hub_role = ${hubRole}, active = ${active}, synced_at = now(), updated_at = now() where email = ${ex[0].email}`;
          } else {
            const first = name.split(/\s+/)[0].toLowerCase();
            await tx`insert into ama_os.staff (email, name, role, preview, active, phone, hub_role, synced_at)
              values (${"hub-" + last9 + "@staff.amatoolkit.local"}, ${name}, ${mapRole(name, hubRole)}, ${PREVIEW.includes(first)}, ${active}, ${"+" + digits}, ${hubRole}, now())
              on conflict (email) do update set name = excluded.name, hub_role = excluded.hub_role, active = excluded.active, phone = excluded.phone, synced_at = now(), updated_at = now()`;
          }
          staff++;
        }
        // Anyone the hub no longer lists is switched off (only rows this sync created or matched).
        if (seen.length) await tx`update ama_os.staff set active = false, updated_at = now() where synced_at is not null and regexp_replace(coalesce(phone, ''), '\\D', '', 'g') <> all(${seen})`;
      }
      await tx`insert into ama_os.mirror_runs (source, rows, note) values (${source}, ${clean.length}, ${staff ? staff + " staff" : null})`;
    });
    return json({ ok: true, source, rows: clean.length, staff });
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message ?? e).slice(0, 300) }, 500);
  }
});
