// AMA OS reads EFC directly (its own keys from ama_os.connections), the same way the hub's "EFC live" pull does.
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
  return await cached("efc_loc_" + school, 86400, async () => {
    const r = await efcGet(school, "/version/1/identity"); const l = (r.body as { locations?: { id?: string; locationId?: string }[] })?.locations?.[0];
    return { id: String(l?.id ?? l?.locationId ?? "") };
  }).then((x) => x.id);
}
const ymdNow = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
const last9 = (v: unknown) => String(v ?? "").replace(/\D/g, "").slice(-9);

type M = Record<string, unknown> & { id: string; groups?: { name: string }[] };
async function enrolled(school: string) {
  const loc = await efcLoc(school); if (!loc) throw new Error(school + ": could not find the EFC location");
  let all: M[] = [], cur = "", n = 0;
  do {
    const r = await efcGet(school, `/version/1/locations/${loc}/members/query?status=enrolled&pageSize=200` + (cur ? "&cursor=" + encodeURIComponent(cur) : ""));
    if (r.code !== 200 || !r.body) throw new Error(school + ": EFC answered " + r.code);
    const b = r.body as { records?: M[]; nextCursor?: string }; all = all.concat(b.records ?? []); cur = b.nextCursor ?? ""; n++;
  } while (cur && n < 40);
  return all;
}

/** Every enrolled member at every school, in the same shape (and with the same flags) as the hub's "EFC live" tab. Cached 10 minutes.
 *  holdByMobile: families on hold now (last 9 digits of the mobile -> text), from AMA OS's hold records. */
export async function membersLive(holdByMobile: Record<string, string>) {
  return await cached("efc_members_v1", 600, async () => {
    const today = ymdNow(), t0 = new Date(today + "T12:00:00Z").getTime(), at = new Date().toISOString(), out: Record<string, unknown>[] = [], errors: string[] = [];
    await Promise.all(SCHOOLS.map(async (s) => {
      if (!(await key(s))) return;
      let rows: M[]; try { rows = await enrolled(s); } catch (e) { errors.push(String((e as Error).message)); return; }
      for (const m of rows) {
        const la = m.lastAttended ? String(m.lastAttended).slice(0, 10) : "", days = la ? Math.round((t0 - new Date(la + "T12:00:00Z").getTime()) / 864e5) : "";
        const bill = !!m.nextInvoiceDate, hold = holdByMobile[last9(m.telephoneMobile)] ?? "", flags: string[] = [];
        if (!bill && (days === "" || (days as number) > 60) && !hold) flags.push("Possible ghost");
        if (bill && days !== "" && (days as number) > 30 && !hold) flags.push("Billing, not training");
        if (Number(m.overdueBalance) > 0) flags.push("Overdue");
        out.push({ "School": s, "Member ID": m.id, "Reference": m.reference ?? "", "Student": [m.firstName, m.lastName].filter(Boolean).join(" ").trim(), "Age": m.age ?? "",
          "Parent": [m.contactFirstName, m.contactLastName].filter(Boolean).join(" ").trim(), "Mobile": m.telephoneMobile ?? "", "Email": m.email ?? "",
          "Groups": (m.groups ?? []).map((g) => g.name).join(", "), "Last attended": la, "Days since": days, "Classes this month": m.monthlyAttended ?? "", "Total classes": m.totalAttended ?? "",
          "Next invoice": m.nextInvoiceDate ? String(m.nextInvoiceDate).slice(0, 10) : "", "Next amount": m.nextInvoiceAmount ?? "", "Overdue": Number(m.overdueBalance) || 0,
          "Enrolled on": m.enrolledOn ? String(m.enrolledOn).slice(0, 10) : "", "Hub hold": hold, "Flags": flags.join(", "), "Pulled at": at });
      }
    }));
    if (!out.length && errors.length) throw new Error(errors.join("; "));
    return { at, rows: out, errors };
  });
}
