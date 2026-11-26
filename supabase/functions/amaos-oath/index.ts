// amaos-oath: Black Belt Oaths for the hub's Member Hub (Documents section), read-only.
// Reads Tate's ama_os.bb_oath view (no signing tokens) with the ama_os_app login.
// Called by the Apps Script hub with the shared sync key (AMAOS_SYNC_KEY), like amaos-sync.
import { sha256, sql } from "../_shared/amaos.ts";

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "POST only." }, 405);
  const want = Deno.env.get("AMAOS_SYNC_KEY") ?? "", got = req.headers.get("x-amaos-sync-key") ?? "";
  if (!want || !got || (await sha256(got)) !== (await sha256(want))) return json({ ok: false, error: "Not allowed." }, 401);
  try {
    const b = await req.json() as { ids?: string[]; refs?: string[] };
    const ids = (b.ids ?? []).map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 20);
    const keys = ids.map((x) => "efc:" + x.toLowerCase());
    const refs = (b.refs ?? []).map(String).filter((x) => /^[A-Za-z0-9-]{3,40}$/.test(x)).slice(0, 20);
    if (!keys.length && !refs.length) return json({ ok: true, oaths: [] });
    const rows = await sql`select member_key, efc_reference, full_name, rank, grading_date, status, sent_at, signed_name, signed_date, signed_at, signature_png, oath_version
      from ama_os.bb_oath
      where member_key = any(${keys}) or efc_reference = any(${refs})
      order by coalesce(signed_at, sent_at) desc nulls last`;
    return json({ ok: true, oaths: rows.map((r) => ({ ...r, id: String(r.member_key ?? "").replace(/^efc:/, "") })) });
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message ?? e).slice(0, 300) }, 500);
  }
});
