// amaos-photos: lists grading photos taken in Tate's Toolkit so the hub can copy each one onto the student's
// Member Hub profile (the Toolkit removes its copies after 30 days). Read-only, ama_os_app login, Tate's
// ama_os.grading_photos view. Called by the Apps Script hub with the shared sync key (AMAOS_SYNC_KEY).
// The image itself is fetched from the Toolkit with a short-lived link (Tate's side), never stored here.
import { sha256, sql } from "../_shared/amaos.ts";

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "POST only." }, 405);
  const want = Deno.env.get("AMAOS_SYNC_KEY") ?? "", got = req.headers.get("x-amaos-sync-key") ?? "";
  if (!want || !got || (await sha256(got)) !== (await sha256(want))) return json({ ok: false, error: "Not allowed." }, 401);
  try {
    const b = await req.json() as { since?: string; limit?: number };
    const since = /^\d{4}-\d{2}-\d{2}T/.test(String(b.since ?? "")) ? String(b.since) : "2000-01-01T00:00:00Z";
    const limit = Math.min(Math.max(Number(b.limit) || 50, 1), 200);
    const rows = await sql`select photo_id, kind, member_key, efc_reference, full_name, belt_to, grading_date, location, photo_path, photo_at
      from ama_os.grading_photos where photo_at > ${since}::timestamptz order by photo_at, photo_id limit ${limit}`;
    return json({ ok: true, photos: rows.map((r) => ({ ...r, id: String(r.member_key ?? "").replace(/^efc:/, "") })) });
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message ?? e).slice(0, 300) }, 500);
  }
});
