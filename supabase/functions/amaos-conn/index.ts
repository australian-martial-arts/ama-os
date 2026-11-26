// amaos-conn: AMA OS's own keys for EFC and GHL (owners only), so AMA OS reads from the source systems directly.
// Keys are saved privately and never returned. "test" checks each key works with a read-only call.
// The hub can hand over the keys it already uses ("import"), when an owner taps the button in the hub's Connections box;
// that call is checked with the AMA OS sync key, not a sign-in.
import { cors, requireStaff, sha256, sql } from "../_shared/amaos.ts";

const OWNERS = ["mark", "sarah", "hakan", "ridvan"];
const SCHOOLS = ["Marrickville", "Concord", "Sydenham", "Auburn", "Sylvania"];
const NAMES: Record<string, string> = {
  GHL_TOKEN: "GHL (GoHighLevel) private integration token",
  ...Object.fromEntries(SCHOOLS.map((s) => ["EFC_KEY_" + s.toUpperCase(), "EFC read key: " + s])),
};
const GHL = { base: "https://services.leadconnectorhq.com", version: "2021-04-15", location: "mJHWOMMUzCTf7U6UVESA" };
const EFC_BASES = ["https://api.efcaquila.com", "https://api.efcaquila.net"];

async function get(name: string) { const r = await sql`select value from ama_os.connections where name = ${name}`; return r.length ? String(r[0].value) : ""; }
async function test(name: string) {
  const v = await get(name); if (!v) return { ok: false, result: "Not set yet" };
  try {
    if (name === "GHL_TOKEN") {
      const r = await fetch(`${GHL.base}/locations/${GHL.location}`, { headers: { Authorization: "Bearer " + v, Version: GHL.version, Accept: "application/json" } });
      return { ok: r.ok, result: r.ok ? "Connected to GHL" : "GHL said " + r.status };
    }
    for (const base of EFC_BASES) {
      const r = await fetch(base + "/version/1/identity", { headers: { "X-API-KEY": v, Accept: "application/json" } });
      if (r.ok) { const j = await r.json().catch(() => ({})); const loc = j?.locations?.[0]?.name ?? j?.locations?.[0]?.id ?? ""; return { ok: true, result: "Connected to EFC" + (loc ? " (" + loc + ")" : "") }; }
      if (r.status === 401 || r.status === 403) return { ok: false, result: "EFC said the key is not allowed (" + r.status + ")" };
    }
    return { ok: false, result: "EFC did not answer" };
  } catch (_e) { return { ok: false, result: "Could not reach it" }; }
}

Deno.serve(async (req) => {
  const c = cors(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: c.headers });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...c.headers, "content-type": "application/json" } });
  try {
    const body = await req.json().catch(() => ({})) as { act?: string; name?: string; value?: string; keys?: Record<string, string>; by?: string };
    // From the hub, when an owner taps "Send to AMA OS" (checked with the sync key).
    const sk = req.headers.get("x-amaos-sync-key");
    if (sk) {
      const want = Deno.env.get("AMAOS_SYNC_KEY") ?? "";
      if (!want || (await sha256(sk)) !== (await sha256(want))) return json({ ok: false, error: "Not allowed." }, 401);
      if (body.act !== "import" || !body.keys) return json({ ok: false, error: "Nothing to import." }, 400);
      const by = String(body.by ?? "hub").slice(0, 60) + " (from the hub)"; let n = 0;
      for (const [k, v] of Object.entries(body.keys)) {
        if (!NAMES[k] || !String(v ?? "").trim()) continue;
        await sql`insert into ama_os.connections (name, value, set_by) values (${k}, ${String(v).trim()}, ${by}) on conflict (name) do update set value = excluded.value, set_by = excluded.set_by, set_at = now()`;
        n++;
      }
      await sql`insert into ama_os.audit (actor, actor_login, role, action, detail) values (${by}, 'hub', 'owner', 'connections-import', ${sql.json({ count: n })})`;
      return json({ ok: true, imported: n });
    }
    const g = await requireStaff(req);
    if (!g.staff) return json({ ok: false, error: g.error }, g.status ?? 403);
    if (!OWNERS.includes(g.staff.first)) return json({ ok: false, error: "Owners only." }, 403);
    const act = String(body.act ?? "list");
    if (act === "set") {
      const name = String(body.name ?? ""), v = String(body.value ?? "").trim();
      if (!NAMES[name]) return json({ ok: false, error: "Unknown connection." }, 400);
      if (v.length < 10) return json({ ok: false, error: "That doesn't look like a full key." }, 400);
      await sql`insert into ama_os.connections (name, value, set_by) values (${name}, ${v}, ${g.staff.name}) on conflict (name) do update set value = excluded.value, set_by = excluded.set_by, set_at = now()`;
      await sql`insert into ama_os.audit (actor, actor_login, role, action, detail) values (${g.staff.name}, ${g.staff.login}, ${g.staff.role}, 'connection-set', ${sql.json({ name })})`;
      return json({ ok: true, ...(await test(name)) });
    }
    if (act === "test") { const name = String(body.name ?? ""); if (!NAMES[name]) return json({ ok: false, error: "Unknown connection." }, 400); return json(await test(name)); }
    const rows = await sql`select name, set_by, set_at from ama_os.connections`;
    const have = Object.fromEntries(rows.map((r) => [r.name, { by: r.set_by, at: new Date(r.set_at as string).toISOString() }]));
    return json({ ok: true, list: Object.entries(NAMES).map(([name, label]) => ({ name, label, set: !!have[name], by: have[name]?.by ?? "", at: have[name]?.at ?? "" })) });
  } catch (e) {
    return json({ ok: false, error: "Something went wrong. Please try again.", detail: String((e as Error).message ?? e).slice(0, 200) }, 500);
  }
});
