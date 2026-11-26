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
export function newMemberCalls(enrolments: Row[], nmRows: Row[], holds: Row[], cx: Row[]) {
  const t = today(), P = pauses(holds, cx, t), fam: Record<string, { key: string; joined: string; students: string[] }> = {};
  for (const r of enrolments) {
    const d = day(r["Enrolled date"]); if (!d || d < NM.from) continue;
    const kid = s(r["Student name"]), pf = s(r["Parent first name"]), pl = s(r["Parent last name"]);
    if (/\btest\b/i.test(kid + " " + pf + " " + pl)) continue;
    const mob = last9(r["Mobile"]), cid = s(r["Contact ID"]), key = mob.length === 9 ? "m" + mob : cid ? "c" + cid : ""; if (!key) continue;
    const f = fam[key] ??= { key, joined: d, students: [] }; if (kid && !f.students.includes(kid)) f.students.push(kid); if (d < f.joined) f.joined = d;
  }
  const byKey: Record<string, Row> = {}; nmRows.forEach((v) => { byKey[s(v["Key"])] = v; });
  const out: { key: string; group: string }[] = [];
  for (const f of Object.values(fam)) {
    const days = diffDays(t, f.joined); if (days > NM.maxDays) continue;
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
