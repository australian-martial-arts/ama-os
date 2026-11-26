// AMA OS reads EFC directly (its own keys from ama_os.connections), the same way the hub's "EFC live" pull does.
// The slow pull runs on a schedule (amaos-dash act "refresh", one school at a time) and is saved in ama_os.cache;
// screens only ever read the saved copy, so they open instantly.
import { sql } from "./amaos.ts";
import { cached } from "./ghl.ts";

export const SCHOOLS = ["Marrickville", "Concord", "Sydenham", "Auburn", "Sylvania"];
const BASES = ["https://api.efcaquila.com", "https://api.efcaquila.net"];
const TZ = "Australia/Sydney";
const keys: Record<string, string> = {};
async function key(school: string) { if (keys[school] !== undefined) return keys[school];
  const r = await sql`select value from ama_os.connections where name = ${"EFC_KEY_" + school.toUpperCase()}`; keys[school] = r.length ? String(r[0].value) : ""; return keys[school]; }
export async function efcConnected() { return (await Promise.all(SCHOOLS.map(key))).some(Boolean); }

let BASE = "";
export async function efcGet(school: string, path: string): Promise<{ code: number; body: unknown }> {
  const k = await key(school); if (!k) return { code: 0, body: null };
  const order = BASE ? [BASE, ...BASES.filter((b) => b !== BASE)] : BASES;
  let last = 0;
  for (const b of order) {
    const r = await fetch(b + path, { headers: { "X-API-KEY": k, Accept: "application/json" } });
    if (r.ok) { BASE = b; return { code: 200, body: await r.json().catch(() => null) }; }
    last = r.status; if (r.status !== 401 && r.status !== 403 && r.status !== 404) break;
  }
  return { code: last, body: null };
}
export async function efcLoc(school: string) {
  return (await cached("efc_loc_" + school, 86400, async () => {
    const r = await efcGet(school, "/version/1/identity"); const l = (r.body as { locations?: { id?: string; locationId?: string }[] })?.locations?.[0];
    if (!l) throw new Error(school + ": EFC identity " + r.code);
    return { id: String(l?.id ?? l?.locationId ?? "") };
  })).id;
}
const last9 = (v: unknown) => String(v ?? "").replace(/\D/g, "").slice(-9);
type M = Record<string, unknown> & { id: string; groups?: { name: string }[] };

/** Scheduled: every enrolled member of one school, saved as "efc_school_<School>". */
export async function pullSchool(school: string) {
  if (!(await key(school))) return { school, skipped: true };
  // A few pages per call (big schools take several calls); progress is saved between calls.
  const t0 = Date.now(), pk = "efc_pull_" + school, prog = await sql`select data, at from ama_os.cache where key = ${pk}`;
  const p = prog.length && Date.now() - new Date(prog[0].at as string).getTime() < 15 * 60000 ? prog[0].data as { cur: string; all: M[] } : { cur: "", all: [] as M[] };
  const loc = await efcLoc(school); let all: M[] = p.all, cur = p.cur, n = 0;
  do {
    const r = await efcGet(school, `/version/1/locations/${loc}/members/query?status=enrolled&pageSize=200` + (cur ? "&cursor=" + encodeURIComponent(cur) : ""));
    if (r.code !== 200 || !r.body) throw new Error(school + ": EFC answered " + r.code);
    const b = r.body as { records?: M[]; nextCursor?: string }; all = all.concat(b.records ?? []); cur = b.nextCursor ?? ""; n++;
  } while (cur && Date.now() - t0 < 60000 && all.length < 8000);
  if (cur) { await sql`insert into ama_os.cache (key, data, at) values (${pk}, ${sql.json({ cur, all } as never)}, now()) on conflict (key) do update set data = excluded.data, at = now()`;
    return { school, more: true, sofar: all.length, pages: n, ms: Date.now() - t0 }; }
  await sql`delete from ama_os.cache where key = ${pk}`;
  const rows = all.map((m) => ({ "School": school, "Member ID": m.id, "Reference": m.reference ?? "", "Student": [m.firstName, m.lastName].filter(Boolean).join(" ").trim(), "Age": m.age ?? "",
    "Parent": [m.contactFirstName, m.contactLastName].filter(Boolean).join(" ").trim(), "Mobile": m.telephoneMobile ?? "", "Email": m.email ?? "",
    "Groups": (m.groups ?? []).map((g) => g.name).join(", "), "Last attended": m.lastAttended ? String(m.lastAttended).slice(0, 10) : "", "Classes this month": m.monthlyAttended ?? "", "Total classes": m.totalAttended ?? "",
    "Next invoice": m.nextInvoiceDate ? String(m.nextInvoiceDate).slice(0, 10) : "", "Next amount": m.nextInvoiceAmount ?? "", "Overdue": Number(m.overdueBalance) || 0,
    "Enrolled on": m.enrolledOn ? String(m.enrolledOn).slice(0, 10) : "" }));
  const at = new Date().toISOString();
  await sql`insert into ama_os.cache (key, data, at) values (${"efc_school_" + school}, ${sql.json({ at, rows } as never)}, now()) on conflict (key) do update set data = excluded.data, at = now()`;
  return { school, members: rows.length, ms: Date.now() - t0 };
}

/** Every saved school, with days since, hold labels (from AMA OS's hold records) and the hub's three flags. null if nothing saved yet. */
export async function membersSaved(holdByMobile: Record<string, string>) {
  const hit = await sql`select key, data from ama_os.cache where key like 'efc_school_%'`;
  if (!hit.length) return null;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date()), t0 = new Date(today + "T12:00:00Z").getTime();
  let oldest = "", rows: Record<string, unknown>[] = [];
  for (const h of hit) { const d = h.data as { at: string; rows: Record<string, unknown>[] }; if (!oldest || d.at < oldest) oldest = d.at; rows = rows.concat(d.rows); }
  rows.forEach((m) => {
    const la = String(m["Last attended"] ?? ""), days = la ? Math.round((t0 - new Date(la + "T12:00:00Z").getTime()) / 864e5) : "";
    const bill = !!m["Next invoice"], hold = holdByMobile[last9(m["Mobile"])] ?? "", flags: string[] = [];
    if (!bill && (days === "" || (days as number) > 60) && !hold) flags.push("Possible ghost");
    if (bill && days !== "" && (days as number) > 30 && !hold) flags.push("Billing, not training");
    if (Number(m["Overdue"]) > 0) flags.push("Overdue");
    m["Days since"] = days; m["Hub hold"] = hold; m["Flags"] = flags.join(", ");
  });
  return { at: oldest, rows };
}
