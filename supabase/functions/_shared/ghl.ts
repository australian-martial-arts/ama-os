// AMA OS reads GHL directly (its own key from ama_os.connections), the same way the hub does.
import { sql } from "./amaos.ts";

const BASE = "https://services.leadconnectorhq.com", VERSION = "2021-04-15", LOCATION = "mJHWOMMUzCTf7U6UVESA", TZ = "Australia/Sydney";
// Same as the hub's CONFIG.locations: which GHL calendar groups are trials for each school.
export const TRIAL_GROUPS: Record<string, string[]> = {
  Auburn: ["Trials - Auburn"], Concord: ["Trials - Concord"], Marrickville: ["Trials - Marrickville", "Open Days Marrickville"],
  Sydenham: ["Trials - Sydenham"], Sylvania: ["Trials - Sylvania"],
};
// Promotion families are not trials (hub PROMO.tags).
const PROMO_TAGS = ["bf2026-paid", "bf2026-gift", "school-readiness-paid", "xmas2026-paid", "ny2027-paid"];
const REC_TAGS = ["in joining chase", "efc link sent automatically", "awaiting efc payment", "online trial booking - pending enrolment"];
const CF = { student_1: "8QGGhG1QgsH3ru76Xbfk", student_2: "BiDFU9Nl0hcpAvCxDjAV" };

let TOKEN = "";
async function token() { if (TOKEN) return TOKEN; const r = await sql`select value from ama_os.connections where name = 'GHL_TOKEN'`; TOKEN = r.length ? String(r[0].value) : ""; return TOKEN; }
export async function ghlConnected() { return !!(await token()); }
async function ghl(path: string, q: Record<string, string | number> = {}) {
  const u = new URL(BASE + path); for (const [k, v] of Object.entries(q)) u.searchParams.set(k, String(v));
  const r = await fetch(u, { headers: { Authorization: "Bearer " + (await token()), Version: VERSION, Accept: "application/json" } });
  if (!r.ok) throw new Error("GHL " + path + " " + r.status);
  return await r.json();
}
export async function cached<T>(key: string, secs: number, fn: () => Promise<T>): Promise<T> {
  const hit = await sql`select data, at from ama_os.cache where key = ${key}`;
  if (hit.length && Date.now() - new Date(hit[0].at as string).getTime() < secs * 1000) return hit[0].data as T;
  const data = await fn();
  await sql`insert into ama_os.cache (key, data, at) values (${key}, ${sql.json(data as never)}, now()) on conflict (key) do update set data = excluded.data, at = now()`;
  return data;
}
async function pool<A, B>(items: A[], n: number, fn: (a: A) => Promise<B>) { const out: B[] = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } })); return out; }

/** Epoch ms of midnight in Sydney on a YYYY-MM-DD day (handles daylight saving). */
export function sydMidnight(day: string) {
  const guess = new Date(day + "T00:00:00Z").getTime();
  const off = (ms: number) => { const p = new Intl.DateTimeFormat("en-US", { timeZone: TZ, timeZoneName: "shortOffset" }).formatToParts(new Date(ms)).find((x) => x.type === "timeZoneName")?.value ?? "GMT+10";
    const m = /GMT([+-])(\d+)(?::(\d+))?/.exec(p); return m ? (m[1] === "-" ? -1 : 1) * (+m[2] * 60 + +(m[3] ?? 0)) : 600; };
  return guess - off(guess - 12 * 36e5) * 60000;
}
const fmt = (ms: number, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-AU", { timeZone: TZ, ...o }).format(new Date(ms));
const ymd = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(ms));
const dayText = (ms: number) => fmt(ms, { weekday: "short", day: "numeric", month: "short" }).replace(",", "");
const timeText = (ms: number) => fmt(ms, { hour: "numeric", minute: "2-digit", hour12: true }).toLowerCase().replace(/\s/g, " ");
const short = (full: string) => { const p = String(full || "").trim().split(/\s+/).filter(Boolean); return !p.length ? "" : p.length === 1 ? p[0] : p[0] + " " + p[p.length - 1].charAt(0).toUpperCase() + "."; };
const className = (name: string) => { if (!name) return "Trial"; const p = String(name).split("|").map((x) => x.trim()); return p.length >= 3 ? p.slice(2).join(" ") : p.length === 2 ? p[1] : "Trial"; };
const titleKids = (t: string) => { const m = /^(.+?) - .+ trial$/i.exec(String(t || "").trim()); return m ? m[1].split(" & ").map((x) => x.trim()).filter(Boolean) : []; };
const progMid = (t: string) => { const m = /\(([^()]+) (\d+) of (\d+)\) trial$/i.exec(String(t || "").trim()); if (!m) return ""; const n = +m[2], N = +m[3]; return n < N ? `Program ${n} of ${N}` : ""; };

type Ev = { id: string; contactId?: string; calendarId: string; startTime: string; title?: string; appointmentStatus?: string; dateAdded?: string };
type Contact = { name: string; tags: string[]; kids: string[] };

/** The hub's trial list (Trials card), built straight from GHL. Records (after-trial check, enrolments, hub bookings) come from AMA OS's copy for now. */
export async function trialsFromGhl(rec: { followup: Record<string, unknown>[]; bookings: Record<string, unknown>[]; enrolledCids: Set<string> }) {
  const now = Date.now(), today = ymd(now);
  const sod = sydMidnight(today);
  const from = sod - 60 * 864e5, to = sod + 15 * 864e5, showFrom = sod - 6 * 864e5, showTo = sod + 8 * 864e5;
  const raw = await cached("ghl_trial_events", 180, async () => {
    const groups = ((await ghl("/calendars/groups", { locationId: LOCATION })).groups ?? []) as { id: string; name: string }[];
    const cals = ((await ghl("/calendars/", { locationId: LOCATION })).calendars ?? []) as { id: string; name: string }[];
    const calName: Record<string, string> = Object.fromEntries(cals.map((c) => [c.id, c.name]));
    const out: { loc: string; e: Ev }[] = [];
    for (const [loc, names] of Object.entries(TRIAL_GROUPS)) {
      const byId: Record<string, Ev> = {};
      for (const n of names) {
        const g = groups.find((x) => x.name === n); if (!g) continue;
        const evs = ((await ghl("/calendars/events", { locationId: LOCATION, groupId: g.id, startTime: from, endTime: to })).events ?? []) as Ev[];
        const seen = new Set<string>();
        evs.filter((e) => !/^(cancelled|canceled|noshow|no-show)$/i.test(String(e.appointmentStatus ?? "")))
          .sort((a, b) => String(a.dateAdded ?? "").localeCompare(String(b.dateAdded ?? "")))
          .forEach((e) => { const k = e.contactId ? e.contactId + "|" + e.calendarId + "|" + e.startTime : ""; if (k && seen.has(k)) return; if (k) seen.add(k); byId[e.id] = e; });
      }
      Object.values(byId).forEach((e) => out.push({ loc, e: { ...e, title: e.title ?? "", calendarId: e.calendarId, cls: className(calName[e.calendarId] ?? "") } as Ev & { cls: string } }));
    }
    return out;
  });
  // Contacts for the trials on screen (names, tags), cached 15 minutes each.
  const shown = raw.filter((x) => { const t = new Date(x.e.startTime).getTime(); return t >= showFrom && t < showTo; });
  const cids = [...new Set(shown.map((x) => x.e.contactId).filter(Boolean))] as string[];
  const contacts: Record<string, Contact | null> = {};
  await pool(cids, 6, async (cid) => {
    contacts[cid] = await cached("ghl_c_" + cid, 900, async () => {
      try { const d = await ghl("/contacts/" + cid); const c = d.contact ?? d; const f: Record<string, string> = {}; (c.customFields ?? []).forEach((x: { id: string; value: string }) => { f[x.id] = x.value; });
        return { name: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.name || "Unknown", tags: (c.tags ?? []).map((t: string) => String(t).trim().toLowerCase()), kids: [f[CF.student_1], f[CF.student_2]].filter(Boolean).map(String) };
      } catch { return null; }
    });
  });
  // After-trial check rows by event, absent events, and trial numbers (same rules as the hub).
  const fu: Record<string, Record<string, unknown>> = {}; rec.followup.forEach((r) => { if (r["Event ID"]) fu[String(r["Event ID"])] = r; });
  const absent = new Set(Object.keys(fu).filter((id) => fu[id]["Attended"] === "Absent"));
  const byC: Record<string, Record<string, string[]>> = {};
  raw.forEach(({ e }) => { if (!e.contactId) return; const d = ymd(new Date(e.startTime).getTime()); ((byC[e.contactId] ??= {})[d] ??= []).push(e.id); });
  // Walk-ins count as visits too (hub tcTrialNums_): event IDs starting with W, by trial date.
  Object.values(fu).forEach((r) => { const id = String(r["Event ID"]), cid = String(r["Contact ID"] ?? ""); if (id.charAt(0) !== "W" || !cid) return;
    const d0 = String(r["Trial date"] ?? ""), m = /^(\d{4}-\d{2}-\d{2})/.exec(d0); const d = m ? m[1] : (d0 ? ymd(new Date(d0).getTime()) : ""); if (!d || sydMidnight(d) < from) return;
    ((byC[cid] ??= {})[d] ??= []).push(id); });
  const num = (cid: string, d: string) => { const days = Object.keys(byC[cid] ?? {}).sort(); if (!days.includes(d)) return "";
    const counted = days.filter((x) => !byC[cid][x].every((id) => absent.has(id))); const k = counted.filter((x) => x < d).length + 1, n = counted.length;
    return n === 2 ? "Trial " + Math.min(k, 2) + " of 2" : (k === 1 ? "1st" : k === 2 ? "2nd" : k === 3 ? "3rd" : k + "th") + " trial"; };
  const src: Record<string, string> = {}; rec.bookings.forEach((r) => { const k = String(r["Event ID"] ?? ""); if (!k) return; if (/\(confirmed/i.test(String(r["Booked by"] ?? ""))) { src[k] ??= "confirmed"; } else src[k] = "hub"; });
  const promo = (c: Contact | null) => !!c && c.tags.some((t) => PROMO_TAGS.includes(t));
  const trials = shown.filter(({ e }) => !promo(contacts[e.contactId ?? ""] ?? null)).map(({ loc, e }) => {
    const t = new Date(e.startTime).getTime(), c = e.contactId ? contacts[e.contactId] : null, past = t + 45 * 60000 < now;
    const kids = (titleKids(e.title ?? "").length ? titleKids(e.title ?? "") : (c?.kids ?? [])).map(short);
    const row = fu[e.id], att = row ? String(row["Attended"] ?? "") : "", tags = c?.tags ?? [];
    const enrolled = tags.includes("enrolled") || (!!e.contactId && rec.enrolledCids.has(e.contactId));
    const recd = (row && String(row["Recommendation sent"]) === "Yes") || REC_TAGS.some((x) => tags.includes(x));
    const status = enrolled ? "Enrolled" : recd ? "Rec sent" : progMid(e.title ?? "") || (att === "Absent" ? "Absent" : att === "Attended" ? "Attended" : att === "Rebooked" ? "Rebooked" : past ? "No update" : "");
    return { t, id: e.id, cid: e.contactId ?? "", src: src[e.id] ?? "online", day: dayText(t), time: timeText(t), loc,
      who: kids.length ? kids.join(" & ") : short(c?.name ?? "") + " (parent)", cls: (e as Ev & { cls: string }).cls, num: e.contactId ? num(e.contactId, ymd(t)) : "", past: t < now, status,
      att, rec: row ? String(row["Recommendation sent"] ?? "") : "" };
  });
  // Walk-ins: recommendations logged with no trial booked (event IDs start with W), as on the hub.
  Object.values(fu).forEach((r) => { const id = String(r["Event ID"]); if (id.charAt(0) !== "W") return;
    const at = new Date(String(r["Reported at"] || r["Trial date"] || "")).getTime(); if (!at || at < showFrom || at >= showTo) return;
    const wcid = String(r["Contact ID"] ?? "");
    trials.push({ t: at, id, cid: wcid, src: "", day: dayText(at), time: timeText(at), loc: String(r["Location"] ?? ""), who: String(r["Child"] || r["Parent"] || ""), cls: "Walk-in (no trial booked)", num: wcid ? num(wcid, ymd(at)) : "", past: true,
      status: rec.enrolledCids.has(String(r["Contact ID"] ?? "")) ? "Enrolled" : "Rec sent", walkin: true } as never); });
  return trials.sort((a, b) => a.t - b.t);
}

/** Last message in each family's GHL conversation (for absentee replies), the same calls as the hub's absReplies_.
 *  Contact ids cached 7 days, "not in GHL" 6 hours, last message 10 minutes, grading check 6 hours. */
export async function lastMessages(e164s: string[], deadline = Date.now() + 90000) {
  const out: Record<string, { dir: string; t: string; ms: number; grading: boolean } | null> = {};
  const GRADE = /\bgrad(e|es|ed|ing)\b|\bbelt\b|invitation to grade|book (their|your) spot/i;
  const norm = (p: string) => { const d = String(p || "").replace(/\D/g, ""); return d.length >= 9 ? "+61" + d.slice(-9) : ""; };
  await pool(e164s, 5, async (e) => {
    if (Date.now() > deadline) return; // not finished: the next run carries on from the saved lookups
    try {
      const c = await cached("ghl_cid_" + e, 7 * 86400, async () => {
        const r = await ghl("/contacts/", { locationId: LOCATION, query: e }); const k = ((r.contacts ?? []) as { id: string; phone?: string }[]).find((x) => norm(x.phone ?? "") === e);
        return { id: k?.id ?? "" };
      });
      if (!c.id) { out[e] = null; return; }
      const h = await cached("ghl_last_" + c.id, 600, async () => {
        const r = await ghl("/conversations/search", { locationId: LOCATION, contactId: c.id }); const cv = (r.conversations ?? [])[0] ?? {};
        const raw = cv.lastMessageDate, ms = raw ? (isNaN(Number(raw)) ? new Date(raw).getTime() : Number(raw)) : 0;
        return { conv: String(cv.id ?? ""), dir: String(cv.lastMessageDirection ?? ""), t: String(cv.lastMessageBody ?? "").replace(/\s+/g, " ").replace(/\s*(On (Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b.*|-+\s*Original Message.*|From: .*)$/i, "").trim().slice(0, 300), ms: ms || 0 };
      });
      let grading = false;
      if (h.dir === "inbound" && h.t && h.ms) {
        if (GRADE.test(h.t)) grading = true;
        else if (h.conv) grading = (await cached("ghl_grade_" + h.conv + "_" + h.ms, 6 * 3600, async () => {
          const r = await ghl("/conversations/" + h.conv + "/messages", { limit: 15 }); const box = r.messages; const list = (box?.messages ?? (Array.isArray(box) ? box : [])) as { direction?: string; messageType?: string; type?: string; body?: string; dateAdded?: string; dateUpdated?: string }[];
          let prev: { t: number; body: string } | null = null;
          for (const m of list) { const t = new Date(m.dateAdded || m.dateUpdated || 0).getTime();
            if (String(m.direction) === "outbound" && !/EMAIL/i.test(String(m.messageType || m.type || "")) && t && t < h.ms && (!prev || t > prev.t)) prev = { t, body: String(m.body || "") }; }
          return { g: !!(prev && GRADE.test(prev.body)) };
        })).g;
      }
      out[e] = { dir: h.dir, t: h.t, ms: h.ms, grading };
    } catch { out[e] = null; }
  });
  return out;
}
