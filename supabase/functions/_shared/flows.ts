// The hub's own work-queue rules (My Day / "Needs you now"), copied exactly so AMA OS counts the same things.
// Inputs are AMA OS's record tables (each row is the hub row, column name -> value).
type Row = Record<string, unknown>;
const TZ = "Australia/Sydney";
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
const s = (v: unknown) => String(v ?? "").trim();
const last9 = (v: unknown) => String(v ?? "").replace(/\D/g, "").slice(-9);
/** Any hub date (ISO, 2026-11-26, 26/11/2026) -> YYYY-MM-DD in Sydney, or "". */
export function day(v: unknown): string {
  const t = s(v); if (!t) return "";
  const iso = /^\d{4}-\d{2}-\d{2}T/.test(t); if (iso) return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(t));
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(t); if (m) return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const d = new Date(t); return isNaN(d.getTime()) ? "" : new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
}
const addDays = (d: string, n: number) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const diffDays = (a: string, b: string) => Math.round((new Date(a + "T12:00:00Z").getTime() - new Date(b + "T12:00:00Z").getTime()) / 864e5);

/** hubHoldList_: every open hold with its stage (waiting, sign, cert, efc, resume, onhold). */
export function holdStages(holds: Row[]) {
  const t = today(), out: (Row & { stage: string })[] = [];
  for (const v of holds) {
    const st = s(v["Status"]);
    if (!s(v["Request ID"]) || /declin|no freeze needed/i.test(st) || s(v["Resumed at"])) continue;
    if (s(v["Extended by"]) && s(v["EFC actioned at"])) continue;
    const fe = day(v["Freeze ends"]);
    let stage: string;
    if (/awaiting/i.test(st)) stage = "waiting";
    else if (!s(v["Signed at"]) && !s(v["EFC actioned at"])) stage = "sign";
    else if (s(v["Certificate"]) === "tofollow") stage = "cert";
    else if (!s(v["EFC actioned at"])) stage = "efc";
    else if (fe && fe <= addDays(t, 3)) stage = "resume";
    else stage = "onhold";
    out.push({ ...v, stage });
  }
  return out;
}
/** My Day "Holds to action": put on, restart or chase in EFC. */
export const holdsToAction = (holds: Row[]) => holdStages(holds).filter((x) => !["waiting", "sign", "onhold"].includes(x.stage));

/** cxList_ + My Day "Cancellations to action in EFC": signed, not yet done in EFC. */
export function cancelsToAction(cx: Row[]) {
  return cx.filter((v) => {
    const st = s(v["Status"]);
    if (/^saved|withdrawn|^duplicate/i.test(st)) return false;
    if (s(v["EFC actioned at"]) && !(/^yes/i.test(s(v["Complaint"])) && !s(v["Complaint outcome"]))) return false;
    return !/test/i.test(st) && !!s(v["Signed at"]) && !s(v["EFC actioned at"]);
  });
}

const NM = { from: "2026-09-15", maxDays: 100, stages: [
  { k: "first", d: 0, owner: "instructor" }, { k: "call3", d: 3, owner: "office" }, { k: "text7", d: 7, owner: "auto" }, { k: "second", d: 10, owner: "office" },
  { k: "call14", d: 14, owner: "office" }, { k: "goal21", d: 21, owner: "instructor" }, { k: "text30", d: 30, owner: "auto" }, { k: "call42", d: 42, owner: "office" },
  { k: "prog60", d: 60, owner: "instructor" }, { k: "text90", d: 90, owner: "auto" }] };
const MON: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
function spokeWithin(notes: unknown, t: string, days: number) {
  return s(notes).split(" | ").some((ln) => {
    const m = /^(\d{1,2}) ([A-Z][a-z]{2}) (?!System)[^:]+: (.*)$/.exec(ln.trim()); if (!m || MON[m[2]] === undefined) return false;
    if (!/(call|check): done|Second class confirmed|No second class yet: called/.test(m[3])) return false;
    const y = +t.slice(0, 4); let d = `${y}-${String(MON[m[2]] + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    if (d > addDays(t, 1)) d = `${y - 1}-${d.slice(5)}`;
    return diffDays(t, d) <= days;
  });
}
/** absPauseMaps_: families on hold or cancelling, by mobile. */
function pauses(holds: Row[], cx: Row[], t: string) {
  const hold: Record<string, { active: boolean; end: string }> = {}, can: Record<string, boolean> = {};
  for (const r of holds) {
    const st = s(r["Status"]); if (/declin|withdrawn|^saved|cancel|test/i.test(st)) continue;
    const m = last9(r["Mobile"]); if (m.length !== 9) continue;
    const end = day(r["Resumed at"]) || day(r["Freeze ends"]), active = !end || end >= t, prev = hold[m];
    if (!prev || (end && (!prev.end || end > prev.end))) hold[m] = { active, end };
  }
  for (const r of cx) { const st = s(r["Status"]); if (/test|withdrawn|^saved|declin/i.test(st)) continue; const m = last9(r["Mobile"]); if (m.length === 9) can[m] = true; }
  return { hold, can };
}
/** nmFamilies_ + My Day "New member calls": families in their first 90 days whose current step is the office's, or with a concern. */
export function newMemberCalls(enrolments: Row[], nmRows: Row[], holds: Row[], cx: Row[], laterRows: Row[] = []) {
  const t = today(), P = pauses(holds, cx, t), fam: Record<string, { key: string; joined: string; students: string[] }> = {};
  // Hub "Later starts" tab: families who start after they enrol are counted from their start date.
  const later: Record<string, string> = {}; for (const r of laterRows) { const m = last9(r["Mobile"]), d = day(r["Start date"]); if (m.length === 9 && d) later[m] = d; }
  for (const r of enrolments) {
    const d = day(r["Enrolled date"]); if (!d || d < NM.from) continue;
    const kid = s(r["Student name"]), pf = s(r["Parent first name"]), pl = s(r["Parent last name"]);
    if (/^\s*zz\b|\btest\b/i.test(kid + " " + pf + " " + pl)) continue;
    const mob = last9(r["Mobile"]), cid = s(r["Contact ID"]), key = mob.length === 9 ? "m" + mob : cid ? "c" + cid : ""; if (!key) continue;
    const f = fam[key] ??= { key, joined: d, students: [] }; if (kid && !f.students.includes(kid)) f.students.push(kid); if (d < f.joined) f.joined = d;
  }
  const byKey: Record<string, Row> = {}; nmRows.forEach((v) => { byKey[s(v["Key"])] = v; });
  const out: { key: string; group: string }[] = [];
  for (const f of Object.values(fam)) {
    const lm = f.key.startsWith("m") ? later[f.key.slice(1)] : undefined, start = lm && lm > f.joined ? lm : f.joined;
    const days = diffDays(t, start); if (days > NM.maxDays) continue;
    const v = byKey[f.key] ?? {}, status = s(v["Status"]); if (status === "Removed" || /^closed/i.test(status)) continue;
    const done = s(v["Done"]).split(",").map((x) => x.trim()).filter(Boolean);
    let cur = -1; NM.stages.forEach((st, i) => { if (days >= st.d) cur = i; }); const st = cur > -1 ? NM.stages[cur] : null;
    const mob = f.key.startsWith("m") ? f.key.slice(1) : "", hp = P.hold[mob];
    let group = "later";
    if (P.can[mob]) group = "paused"; else if (hp && hp.active) group = "paused"; else if (/^concern/i.test(status)) group = "concern";
    else if (days < 0) group = "later";
    else if (st && !done.includes(st.k) && !(st.owner === "office" && spokeWithin(v["Notes"], t, 7))) group = st.owner;
    else group = NM.stages[cur + 1] ? "later" : "complete";
    out.push({ key: f.key, group });
  }
  return out.filter((x) => x.group === "office" || x.group === "concern");
}

// ---------- Absent follow-up (hub absFamilies_ + absTagExtras_), read-only: AMA OS never changes the hub's absentee records ----------
const ABS = { silenceDays: 90, fourteenFrom: "2026-10-26T21:20:00+11:00", repeatDays: 30, repeatMin: 2,
  stages: [{ k: "auto7", d: 9, owner: "auto" }, { k: "call1", d: 12, owner: "office" }, { k: "video", d: 15, owner: "instructor" }, { k: "call2", d: 18, owner: "office" },
    { k: "head", d: 21, owner: "head" }, { k: "auto30", d: 30, owner: "auto" }, { k: "final", d: 35, owner: "office" }] };
const XMAS = { from: "2026-12-21", to: "2027-01-11" };
const stageAt = (days: number) => { let x = -1; ABS.stages.forEach((st, i) => { if (days >= st.d) x = i; }); return x; };
const stageIdx = (k: string) => ABS.stages.findIndex((st) => st.k === k);
const absLog = (notes: unknown) => { const t = s(notes), i = t.indexOf(" | "); return i > -1 ? t.slice(i + 3) : ""; };
const xmasDays = (from: string, to: string) => { const a = from > XMAS.from ? from : XMAS.from, b = to < XMAS.to ? to : XMAS.to; return b > a ? diffDays(b, a) : 0; };
export type AbsFamily = { key: string; group: string; days: number; e164: string; log: string; ids: string[] };
/** rows: the hub's Absentees tab in sheet order. */
export function absentFamilies(rows: Row[], holds: Row[], cx: Row[]): AbsFamily[] {
  const t = today();
  // hub pause maps (holds active/ended, cancellations gone)
  const hold: Record<string, { active: boolean; end: string }> = {}, can: Record<string, { gone: boolean }> = {};
  for (const r of holds) { const st = s(r["Status"]); if (/declin|withdrawn|^saved|cancel|test/i.test(st)) continue; const m = last9(r["Mobile"]); if (m.length !== 9) continue;
    const end = day(r["Resumed at"]) || day(r["Freeze ends"]), prev = hold[m]; if (!prev || (end && (!prev.end || end > prev.end))) hold[m] = { active: !end || end >= t, end }; }
  for (const r of cx) { const st = s(r["Status"]); if (/test|withdrawn|^saved|declin/i.test(st)) continue; const m = last9(r["Mobile"]); if (m.length !== 9) continue;
    const last = day(r["Last class"]) || day(r["Notice ends"]); can[m] = { gone: !!(last && last < t) }; }
  const lk = (v: Row) => day(v["Last attended"]);
  // 1) silencing (EFC record wrong) and 14-day alerts
  const has14: Record<string, 1> = {}, silenced: Record<string, 1> = {};
  rows.forEach((v) => { const id = s(v["EFC member ID"]), out = s(v["Outcome"]), st = s(v["Status"]), rec = s(v["Received at"]);
    if (id && (s(v["Days absent"]) === "14" || (rec && new Date(rec) < new Date(ABS.fourteenFrom)))) has14[id + "|" + lk(v)] = 1;
    if (out === "EFC record wrong" && id) { const at = day(rec) || t; if (!/^EFC fixed/i.test(st) && diffDays(t, at) < ABS.silenceDays) silenced[id] = 1; } });
  // 2) open rows: newest "Last attended" per member wins
  const open: Record<string, { v: Row; lk: string; id: string; i: number }> = {};
  rows.forEach((v, i) => { const st = s(v["Status"]), id = s(v["EFC member ID"]); if (/^closed|^efc fixed/i.test(st)) return;
    const name = (s(v["First name"]) + " " + s(v["Last name"])).trim(); if (/^\s*zz\b|\btest\b/i.test(name)) return;
    if (id && silenced[id] && s(v["Outcome"]) !== "EFC record wrong") return;
    const key = id || "r" + i, k = lk(v), prev = open[key]; if (prev && !(k > prev.lk)) return; open[key] = { v, lk: k, id, i }; });
  // 3) families and stages
  const fam: Record<string, { key: string; ids: string[]; log: string; status: string; done: number; e164: string; pause: string; days: number }> = {};
  for (const o of Object.values(open)) {
    const v = o.v, last = lk(v), mob = last9(v["Mobile"]), hp = hold[mob], cp = can[mob];
    if (cp && cp.gone) continue;
    let base = last; if (hp && hp.end && hp.end < t && (!base || hp.end > base)) base = hp.end;
    const days = base ? Math.max(0, diffDays(t, base) - xmasDays(base, t)) : 0, raw = last ? diffDays(t, last) : null, rec = s(v["Received at"]);
    if (o.id && /^(7|9)$/.test(s(v["Days absent"])) && !hp && raw !== null && raw >= 16 && !has14[o.id + "|" + o.lk] && rec && new Date(rec) >= new Date(ABS.fourteenFrom)) continue;
    const email = s(v["Email"]).toLowerCase(), fk = mob.length === 9 ? "m" + mob : email ? "e" + email : "r" + o.i;
    const f = fam[fk] ??= { key: fk, ids: [], log: "", status: "", done: -1, e164: mob.length === 9 ? "+61" + mob : "", pause: "", days: 0 };
    if (hp && hp.active) f.pause = "hold"; if (cp) f.pause = "cancel";
    const es = s(v["EFC status"]); if (es && !/^(enrolled|active)/i.test(es) && !f.pause) f.pause = "inactive";
    if (o.id) f.ids.push(o.id);
    const lg = absLog(v["Notes"]); if (lg.length >= f.log.length) { f.log = lg; f.status = s(v["Status"]); }
    f.done = Math.max(f.done, stageIdx(s(v["Stage done"]))); f.days = Math.max(f.days, days);
  }
  // repeat absentees (absTagExtras_): 2+ absences in 30 days skip the automatic text and go to the office
  const since = Date.now() - ABS.repeatDays * 864e5, cnt: Record<string, Set<string>> = {};
  rows.forEach((v, i) => { const id = s(v["EFC member ID"]); if (!id || /duplicate|EFC record wrong/i.test(s(v["Outcome"]))) return; const rec = s(v["Received at"]); if (!rec || new Date(rec).getTime() < since) return;
    (cnt[id] ??= new Set()).add(lk(v) || "r" + i); });
  return Object.values(fam).map((f) => {
    const cur = stageAt(f.days), st = cur > -1 ? ABS.stages[cur] : null, m = /(\d{4}-\d{2}-\d{2})/.exec(f.status), when = m ? m[1] : "";
    let group = "later";
    if (f.pause) group = f.pause;
    else if (/^return booked/i.test(f.status)) group = when < t ? "check" : "booked";
    else if (/^call back/i.test(f.status) && when > t) group = "later";
    else if (/^call back/i.test(f.status)) group = "office";
    else if (st && cur > f.done) group = st.owner === "auto" ? "auto" : st.owner;
    const rep = f.ids.reduce((a, id) => Math.max(a, cnt[id]?.size ?? 0), 0);
    if (rep >= ABS.repeatMin && group === "auto") group = "office";
    return { key: f.key, group, days: f.days, e164: f.e164, log: f.log, ids: f.ids };
  });
}
/** Has the family texted back since our last absentee text, with no outcome logged since? (hub absReplies_; grading replies excluded). */
export function replyOpen(f: AbsFamily, last: { dir: string; t: string; ms: number; grading: boolean } | null) {
  const SENT = /System: (Day 9|Day 30|No-answer|Booking confirmation) text sent/;
  if (!last || last.dir !== "inbound" || !last.t || !last.ms || last.grading) return false;
  const y = +today().slice(0, 4), MON2 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const pd = (p: string) => { const m = /^(\d{1,2}) ([A-Z][a-z]{2})/.exec(p.trim()); if (!m) return ""; const mo = MON2.indexOf(m[2]); if (mo < 0) return "";
    let d = `${y}-${String(mo + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`; if (diffDays(d, today()) > 40) d = `${y - 1}-${d.slice(5)}`; return d; };
  let sent = "", staff = "";
  f.log.split(" | ").forEach((p) => { if (SENT.test(p)) sent = pd(p) || sent; else if (!/System:/.test(p)) staff = pd(p) || staff; });
  const atDay = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(last.ms));
  if (!sent || atDay < sent) return false;
  if (staff && staff >= atDay) return false;
  return true;
}
export const needsReplyCheck = (f: AbsFamily) => !!f.e164 && /System: (Day 9|Day 30|No-answer|Booking confirmation) text sent/.test(f.log);
