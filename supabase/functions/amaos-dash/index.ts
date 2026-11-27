// amaos-dash: read-only dashboard and family lookup for AMA OS, built from the nightly copy of the hub (ama_os.mirror).
// Signed-in AMA OS staff only (owners, full-access admins and admins also need their second step).
// Uses the ama_os_app database login only. Screens read saved results; the only write is the after-trial check,
// which goes through the hub (the hub stays in charge until the switch-over, so nothing is sent twice).
// EFC money (next invoice amounts, overdue amounts) is shown to Mark, Sarah, Hakan, Ridvan and Busra only (Mark's rule).
import { cors, requireStaff, sql } from "../_shared/amaos.ts";
import { ghlConnected, lastMessages, trialsFromGhl } from "../_shared/ghl.ts";
import { membersSaved, pullSchool, SCHOOLS as EFC_SCHOOLS } from "../_shared/efc.ts";
import { sha256 } from "../_shared/amaos.ts";
import { absentFamilies, cancelsToAction, holdsToAction, needsReplyCheck, newMemberCalls, replyOpen } from "../_shared/flows.ts";

let refreshKeyHash = "", refreshKeyAt = 0, bgQueue: Promise<unknown> = Promise.resolve();
// 27 Nov 2026 (Mark): Tate tests every new system as it comes across, so he gets each preview too.
const HUB_PREVIEW = ["mark", "tate"], HUB_KINDS = ["approvals", "apprhold", "cxapprove", "traindecide", "mywork", "mwtick", "partyupdate", "check", "checksave", "reqlist", "reqact", "trialopts", "trialslots", "trialbook", "hubreq", "shifts", "failpay", "stars", "absvideo", "liveatt", "reflist", "partyhub", "pvlist", "camphub", "stocklist", "stockmove", "links", "ihub", "staff", "trainreq", "ppf", "skills", "myavail", "epblist", "epbtoken", "epbnewstaff", "epbsave", "payroster", "payshift", "payshiftdel", "payextra", "payweek", "payleave", "payleaveact", "paycover", "paycoverset", "paystaff", "payclosed", "headleave", "holdlist", "holdaction", "holdextend", "cxlist", "cxsent", "cxaction", "chaselist", "chaseaction", "followups", "followupdone", "replylist", "replydone", "replyundo", "nmlist", "nmaction", "abslist", "absaction", "abstext", "abslogin", "absnsi", "refaction", "trialinfo", "trialcallback", "trialcall24", "trialmove", "trialremove", "gradelist", "gradesave", "gradefix", "pvbook", "pvstatus", "pvavail", "campupdate", "campapprove", "campswap", "campmove", "efcatt", "efcchecks", "efclive", "efcuse", "camplink", "campcash", "printreq"];
const HUB_READ_ACTS: Record<string, string[]> = { stars: ["cfg"], liveatt: ["day"], staff: ["me"], ppf: ["mine", "cal"], skills: ["mine", "queue"], myavail: ["get"] }; // other actions that only read, so a saved copy can be shown
const HUB_LOOKUP: Record<string, string[]> = { stars: ["family"], ppf: ["get"], efcatt: ["members", "classes", "history"], camplink: [] }; // read-only look-ups that are not saved or logged
const HUB_READ: Record<string, number> = { printreq: 300, efcchecks: 3600, efclive: 3600, efcuse: 3600, approvals: 900, mywork: 900, reqlist: 900, check: 600, trialopts: 21600, hubreq: 900, shifts: 900, failpay: 900, stars: 900, absvideo: 900, liveatt: 120, reflist: 900, partyhub: 600, pvlist: 900, camphub: 600, stocklist: 600, links: 3600, ihub: 600, staff: 900, ppf: 600, skills: 600, myavail: 600, epblist: 600, payroster: 300, payweek: 3600, payleave: 300, paycover: 300, paystaff: 600, holdlist: 600, cxlist: 600, cxsent: 900, chaselist: 600, followups: 600, replylist: 600, nmlist: 600, abslist: 600, gradelist: 900 }; // seconds a saved copy may be shown
const hubKey = (first: string, body: Record<string, unknown>) => "hub:" + first + ":" + String(body.kind) + ["act", "loc", "school", "date", "from", "days", "mon"].filter((k) => body[k] != null && body[k] !== "").map((k) => ":" + String(body[k])).join("");
async function hubCall(who: string, mobile: string, body: Record<string, unknown>) {
  const key = Deno.env.get("AMAOS_SYNC_KEY") ?? ""; if (!key) return { ok: false, error: "AMA OS can't reach the hub yet (no sync key)." } as Record<string, unknown>;
  const r = await fetch(HUB_EXEC, { method: "POST", headers: { "content-type": "application/json" }, redirect: "follow",
    body: JSON.stringify({ kind: "amaoswrite", key, who, act: "route", mobile, body }) });
  return await r.json().catch(() => ({ ok: false, error: "The hub didn't answer properly (" + r.status + ")." })) as Record<string, unknown>;
}
async function hubSave(ck: string, data: Record<string, unknown>) {
  await sql`insert into ama_os.cache (key, data, at) values (${ck}, ${sql.json(data as never)}, now()) on conflict (key) do update set data = excluded.data, at = now()`;
}
const HUB_EXEC = "https://script.google.com/macros/s/AKfycby0ZH6268IMypMEv7gjQFRdBxZ0L1jxe7LB780wEya8XRjiOAKf4pbO6MOFOrJVO35J/exec";
const MGMT = ["mark", "sarah", "hakan", "ridvan"];
const MONEY = ["mark", "sarah", "hakan", "ridvan", "busra"]; // 26 Nov 2026 (Mark): Busra added
const SCHOOLS = ["Marrickville", "Concord", "Sydenham", "Auburn", "Sylvania"];
type Row = Record<string, unknown>;

function school(s: unknown) {
  const t = String(s ?? "");
  if (/marrick/i.test(t)) return "Marrickville"; if (/concord/i.test(t)) return "Concord"; if (/syden/i.test(t)) return "Sydenham";
  if (/auburn|west/i.test(t)) return "Auburn"; if (/sylvan/i.test(t)) return "Sylvania"; return "";
}
const MON: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
/** Any date the hub writes (ISO, 26/11/2026, "Thu 27 Nov 4pm") -> "YYYY-MM-DD", or "". */
function ymd(v: unknown, today: string): string {
  const s = String(v ?? "").trim(); if (!s) return "";
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/); if (m) { const y = m[3].length === 2 ? "20" + m[3] : m[3]; return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
  m = s.match(/\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:\s+(\d{4}))?/i);
  if (m) {
    const mo = MON[m[2].toLowerCase()]; let y = m[3] ? +m[3] : +today.slice(0, 4);
    let d = `${y}-${String(mo).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    if (!m[3] && d < addDays(today, -200)) { y++; d = `${y}-${String(mo).padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
    return d;
  }
  return "";
}
function addDays(d: string, n: number) { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
function sydToday() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(new Date()); }
const last9 = (v: unknown) => String(v ?? "").replace(/\D/g, "").slice(-9);
const num = (v: unknown) => { const n = Number(String(v ?? "").replace(/[^0-9.\-]/g, "")); return isNaN(n) ? 0 : n; };
const yes = (v: unknown) => v === true || /^(true|yes|y)$/i.test(String(v ?? "").trim());
const pick = (r: Row, keys: string[]) => { const o: Row = {}; for (const k of keys) if (r[k] !== undefined && r[k] !== "") o[k] = r[k]; return o; };

// Small per-instance cache so a busy front desk doesn't re-read the same copy every few seconds.
const CACHE = new Map<string, { at: number; rows: Row[] }>();
// 26 Nov 2026 (Mark): the critical flows read AMA OS's own record tables (filled from the hub until switch-over).
const RECORDS: Record<string, string> = { "Holds": "holds", "Cancellations": "cancellations", "Trial follow-up": "trial_followups", "New members": "new_members", "Enrolments": "enrolments", "Hub trial bookings": "trial_bookings" };
async function src(name: string): Promise<Row[]> {
  const hit = CACHE.get(name); if (hit && Date.now() - hit.at < 60000) return hit.rows;
  const t = RECORDS[name];
  const rows = (t ? await sql.unsafe("select data from ama_os." + t) /* t is from the fixed RECORDS list */ : await sql`select data from ama_os.mirror where source = ${name}`).map((r) => r.data as Row);
  CACHE.set(name, { at: Date.now(), rows }); return rows;
}

// 26 Nov 2026 (Mark): members straight from EFC with AMA OS's own keys; the hub's nightly copy is only the fallback.
async function members(): Promise<{ rows: Row[]; live: boolean; at: string }> {
  try {
    const today = sydToday(), hold: Record<string, string> = {};
    (await src("Holds")).forEach((r) => { const a = ymd(r["Freeze starts"], today), b = ymd(r["Freeze ends"], today);
      if (a && b && a <= today && today <= b && !/reject|declin|cancel|withdr/i.test(String(r["Status"] ?? ""))) hold[last9(r["Mobile"])] = "On hold until " + b; });
    const r = await membersSaved(hold); if (r) return { rows: r.rows as Row[], live: true, at: r.at };
  } catch (e) { console.log("efc members: " + (e as Error).message); }
  return { rows: await src("EFC live"), live: false, at: "" };
}

async function dash(money: boolean) {
  const today = sydToday(), d30 = addDays(today, -30), d7 = addDays(today, 7);
  // One read at a time: the database pooler stalls when several large reads share one connection.
  const gt = await src("GHL trials"), mem = await members(), holds = await src("Holds"), cx = await src("Cancellations"), nm = await src("New members");
  const tb = await src("Hub trial bookings"), tf = await src("Trial follow-up"), ab = await src("Absentees");
  const runs = await sql`select source, max(at) as at from ama_os.mirror_runs group by source`;
  const efc = mem.rows;
  const by = () => Object.fromEntries(SCHOOLS.map((s) => [s, 0])) as Record<string, number>;
  const S: Record<string, Record<string, number>> = { members: by(), onHold: by(), newMembers: by(), cancels: by(), trialsNext7: by(), trialsLast30: by(), attendedLast30: by(), quiet14: by() };
  let overdue = 0, overdueAmt = 0, nextAmt = 0;
  for (const r of efc) {
    const s = school(r["School"]); if (!s) continue;
    S.members[s]++; if (r["Hub hold"]) S.onHold[s]++;
    if (num(r["Days since"]) >= 14) S.quiet14[s]++;
    if (num(r["Overdue"]) > 0) { overdue++; overdueAmt += num(r["Overdue"]); }
    nextAmt += num(r["Next amount"]);
  }
  for (const r of nm) { const d = ymd(r["Start date"], today); const s = school(r["School"]); if (s && d >= d30 && d <= today) S.newMembers[s]++; }
  for (const r of cx) { const d = ymd(r["Logged at"], today); const s = school(r["Trains at"]); if (s && d >= d30 && !/reject|withdr|stay|retain|cancelled request/i.test(String(r["Status"] ?? ""))) S.cancels[s]++; }
  const upcoming: Row[] = [];
  for (const r of tb) {
    const d = ymd(r["Trial"], today); const s = school(r["School"]);
    if (s && d >= today && d <= d7) { S.trialsNext7[s]++; upcoming.push({ date: d, when: r["Trial"], school: s, child: r["Child"], cls: r["Class"] }); }
  }
  // GHL trials (sent by the hub every 10 minutes, the same list as the hub's Trials card). When present, they set the 7-day count.
  // 26 Nov 2026 (Mark): straight from GHL with AMA OS's own key; the hub's copy is only the fallback.
  let trials: Row[] = [], trialsLive = false;
  let trialsSavedAt = "";
  { const t = await sql`select data, at from ama_os.cache where key = 'trials_live'`;
    if (t.length && Date.now() - new Date(t[0].at as string).getTime() < 30 * 60000) { trials = (t[0].data as { trials: Row[] }).trials; trialsLive = true; trialsSavedAt = new Date(t[0].at as string).toISOString(); } }
  if (!trialsLive) trials = gt.filter((t) => typeof t.t === "number").sort((a, b) => (a.t as number) - (b.t as number));
  if (trials.length) {
    const off = (new Intl.DateTimeFormat("en-US", { timeZone: "Australia/Sydney", timeZoneName: "shortOffset" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value ?? "GMT+11").replace("GMT", "") || "+11";
    const sod = new Date(today + "T00:00:00" + (off.includes(":") ? off : off.replace(/^([+-])(\d+)$/, (_m, g, h) => g + h.padStart(2, "0") + ":00"))).getTime(), end = sod + 8 * 864e5;
    S.trialsNext7 = by();
    trials.forEach((t) => { const s = school(t.loc); if (s && !t.walkin && (t.t as number) >= sod && (t.t as number) < end) S.trialsNext7[s]++; });
  }
  for (const r of tf) {
    const d = ymd(r["Trial date"], today); const s = school(r["Location"]);
    if (s && d >= d30 && d < today) { S.trialsLast30[s]++; if (/^(y|yes|true|attended|came)/i.test(String(r["Attended"] ?? ""))) S.attendedLast30[s]++; }
  }
  const holdsNow = holds.filter((r) => { const a = ymd(r["Freeze starts"], today), b = ymd(r["Freeze ends"], today);
    return a && b && a <= today && today <= b && !/reject|declin|cancel|withdr/i.test(String(r["Status"] ?? "")); });
  const hBy = by(); holdsNow.forEach((r) => { const s = school(r["Trains at"]); if (s) hBy[s]++; });
  // Absentee follow-ups still open: alert in the last 35 days, not closed, and the member still hasn't trained in 7+ days (one per member).
  const days = new Map(efc.map((r) => [String(r["Member ID"] ?? ""), num(r["Days since"])]));
  const d35 = addDays(today, -35), openIds = new Set<string>();
  for (const r of ab) {
    const id = String(r["EFC member ID"] ?? ""), d = ymd(r["Received at"], today);
    if (!id || !d || d < d35 || /clos|came|back|done|cancel|left/i.test(String(r["Status"] ?? "") + " " + String(r["Outcome"] ?? ""))) continue;
    if (days.has(id) && (days.get(id) as number) >= 7) openIds.add(id);
  }
  const absOpen = openIds.size;
  // "Needs you now" and "This week" (hub-style home). Open items by status words the hub uses.
  const wk7 = addDays(today, -6), d90 = addDays(today, -90);
  // Same rules as the hub's My Day queues (holds to action, cancellations to action in EFC, new member calls).
  const enr = await src("Enrolments");
  const ac = await sql`select data from ama_os.cache where key = 'absent_counts' and at > now() - interval '30 minutes'`, A = ac.length ? ac[0].data as { absreply: number; absent: number } : null;
  const needs = { holds: holdsToAction(holds).length, cancels: cancelsToAction(cx).length, newmem: newMemberCalls(enr, nm, holds, cx, await src("Later starts")).length, absent: A ? A.absreply + A.absent : null, absreply: A ? A.absreply : null };
  const week = {
    from: wk7, to: today,
    joined: nm.filter((r) => { const d = ymd(r["Start date"], today); return d >= wk7 && d <= today; }).length,
    cancelled: cx.filter((r) => { const d = ymd(r["Logged at"], today); return d >= wk7 && d <= today; }).length,
    holds: holds.filter((r) => { const d = ymd(r["Logged at"], today); return d >= wk7 && d <= today; }).length,
    members: efc.length,
  };
  // 12-week trend: new members vs cancellation requests per week (weeks start Monday).
  const weeks: { wk: string; joined: number; left: number }[] = [];
  const dow = (new Date(today + "T12:00:00Z").getUTCDay() + 6) % 7, mon = addDays(today, -dow);
  for (let i = 11; i >= 0; i--) weeks.push({ wk: addDays(mon, -7 * i), joined: 0, left: 0 });
  const wkOf = (d: string) => { for (let i = weeks.length - 1; i >= 0; i--) if (d >= weeks[i].wk) return i; return -1; };
  nm.forEach((r) => { const d = ymd(r["Start date"], today); const i = d && d <= today ? wkOf(d) : -1; if (i > -1) weeks[i].joined++; });
  cx.forEach((r) => { const d = ymd(r["Logged at"], today); const i = d ? wkOf(d) : -1; if (i > -1) weeks[i].left++; });
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : "");
  const at = runs.filter((r) => r.source !== "GHL trials").reduce((m: string, r) => { const t = iso(r.at); return t > m ? t : m; }, "");
  const trialsAt = trialsLive ? trialsSavedAt : iso((runs.find((r) => r.source === "GHL trials") || {}).at);
  return {
    today, syncedAt: at, schools: SCHOOLS, by: { ...S, holdsNow: hBy },
    totals: Object.fromEntries(Object.entries({ ...S, holdsNow: hBy }).map(([k, v]) => [k, Object.values(v).reduce((a, b) => a + b, 0)])),
    absenteesOpen: absOpen, weeks, trials, trialsAt, trialsLive, needs, week, membersLive: mem.live, membersAt: mem.at,
    upcoming: upcoming.sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(0, 60),
    money: money ? { overdueFamilies: overdue, overdueTotal: Math.round(overdueAmt), nextInvoicesTotal: Math.round(nextAmt) } : null,
  };
}

// Read-only lists of the critical flows (side-by-side checks before the switch-over).
const LISTS: Record<string, { src: string; date: string; school: string; cols: string[]; money?: string[]; mgmt?: boolean }> = {
  holds: { src: "Holds", date: "Logged at", school: "Trains at", cols: ["Logged at", "Status", "Account holder", "Mobile", "Students", "Trains at", "Reason", "Freeze starts", "Freeze ends", "Weeks", "Taken by", "Approved by", "Signed at", "EFC actioned at", "Resumed at", "Notes"], money: ["Weekly rate"] },
  cancels: { src: "Cancellations", date: "Logged at", school: "Trains at", cols: ["Logged at", "Status", "Account holder", "Mobile", "Students", "Trains at", "Reason", "In their words", "Notice ends", "Last class", "Taken by", "Approved by", "Signed at", "EFC actioned at", "Exit rating", "Rejoined", "Notes"], money: ["Uniform balance"] },
  newmembers: { src: "New members", date: "Start date", school: "School", cols: ["Start date", "Status", "Family", "Mobile", "Students", "School", "Done", "Handled by", "Notes", "Updated at"] },
  // 27 Nov 2026: more hub tabs, read-only (changes are still made in the hub until the switch-over).
  close: { src: "Sales chase", date: "Recommended at", school: "School", cols: ["Recommended at", "Outcome", "Family", "Mobile", "Students", "School", "Recommended by", "Attempts", "Last action", "Last action at", "Last action by", "Next due", "Reason not joined", "Closed at", "Notes"], money: ["Weekly"] },
  absent: { src: "Absentees", date: "Received at", school: "School", cols: ["Received at", "Status", "First name", "Last name", "Mobile", "School", "Days absent", "Last attended", "Stage done", "Handled by", "Outcome", "Reason", "Notes"] },
  grading: { src: "LD grading", date: "Nominated at", school: "School", cols: ["Nominated at", "Status", "Student", "Age", "School", "Current belt", "Going for", "Nominated by", "Decided by", "Decided at", "Sent at", "Toolkit status"] },
  promos: { src: "Promotions", date: "Start", school: "Schools", cols: ["Start", "Status", "Name", "Length", "Schools", "Who it is for", "Included", "Hand-outs", "Collect", "Skip trial", "Tags", "Staff notes"] },
  mediaopt: { src: "Media opt-out", date: "Ticked on", school: "School", cols: ["Ticked on", "Student", "Age", "Parent", "School", "Groups", "Photo", "Form"], mgmt: true },
  staff: { src: "Hub staff", date: "Last sign-in", school: "Areas", cols: ["Last sign-in", "Name", "Position", "Role", "Active", "Areas", "Mobile", "Notes"], mgmt: true },
  students: { src: "@members", date: "Last attended", school: "School", cols: ["Last attended", "Student", "Age", "Parent", "Mobile", "School", "Groups", "Days since", "Classes this month", "Total classes", "Enrolled on", "Hub hold", "Flags", "Reference"], money: ["Next invoice", "Next amount", "Overdue"] },
  followup: { src: "Trial follow-up", date: "Trial date", school: "Location", cols: ["Trial date", "Trial time", "Location", "Child", "Class", "Parent", "Mobile", "Attended", "Recommendation sent", "Follow-up", "Next follow-up", "Followed up by", "Follow-up note", "Notes"] },
};
async function list(kind: string, money: boolean, mgmt = false) {
  const L = LISTS[kind]; if (!L) return { ok: false, error: "Unknown list." };
  if (L.mgmt && !mgmt) return { ok: false, error: "Management only." };
  const today = sydToday(), rows = L.src === "@members" ? (await members()).rows : await src(L.src), cols = money && L.money ? L.cols.concat(L.money) : L.cols;
  const out = rows.map((r) => ({ ...pick(r, cols), _d: ymd(r[L.date], today), _s: school(r[L.school]) }))
    .sort((a, b) => String(b._d).localeCompare(String(a._d))).slice(0, 800);
  return { ok: true, kind, today, cols, total: rows.length, rows: out };
}

const KID = ["School", "Student", "Age", "Groups", "Last attended", "Days since", "Classes this month", "Total classes", "Enrolled on", "Hub hold", "Flags", "Reference"];
async function find(q: string, money: boolean) {
  const today = sydToday(), mem = await members(), efc = mem.rows, qd = q.replace(/\D/g, ""), ql = q.toLowerCase();
  const hit = efc.filter((r) => (qd.length >= 6 && last9(r["Mobile"]).includes(qd.slice(-9))) ||
    (ql.length >= 2 && [r["Student"], r["Parent"], r["Email"], r["Reference"]].some((v) => String(v ?? "").toLowerCase().includes(ql))));
  const fams = new Map<string, { mobile: string; parent: string; email: string; kids: Row[] }>();
  for (const r of hit) {
    const k = last9(r["Mobile"]) || String(r["Parent"] ?? r["Student"]);
    const f = fams.get(k) ?? { mobile: String(r["Mobile"] ?? ""), parent: String(r["Parent"] ?? ""), email: String(r["Email"] ?? ""), kids: [] };
    f.kids.push(pick(r, money ? KID.concat(["Next invoice", "Next amount", "Overdue"]) : KID)); fams.set(k, f);
  }
  const list = [...fams.entries()].slice(0, 15);
  if (!list.length) return { families: [] };
  const holds = await src("Holds"), cx = await src("Cancellations"), tb = await src("Hub trial bookings"), nm = await src("New members"), docs = await src("Member docs"), ab = await src("Absentees");
  const mine = (rows: Row[], key9: string) => rows.filter((r) => last9(r["Mobile"]) === key9 && key9.length === 9);
  const families = list.map(([k9, f]) => ({
    ...f,
    holds: mine(holds, k9).map((r) => pick(r, ["Status", "Students", "Trains at", "Reason", "Freeze starts", "Freeze ends", "Weeks", "Approved by", "Logged at"])),
    cancellations: mine(cx, k9).map((r) => pick(r, ["Status", "Students", "Trains at", "Reason", "Logged at", "Last class", "Notice ends", "Rejoined"])),
    trials: mine(tb, k9).map((r) => pick(r, ["Trial", "Child", "School", "Class", "Booked by", "How they heard"])),
    joined: mine(nm, k9).map((r) => pick(r, ["Students", "School", "Start date", "Status", "Handled by"])),
    docs: mine(docs, k9).length ? mine(docs, k9).map((r) => pick(r, Object.keys(r).filter((x) => !/mobile|email|url|link|file/i.test(x)).slice(0, 6))) : [],
    absent: mine(ab, k9).length,
  }));
  return { today, families, more: fams.size > list.length, membersLive: mem.live, membersAt: mem.at };
}

/* Scheduled refresh (GitHub Actions every 5 minutes, key read from the database): does all the slow work so screens open instantly.
   what: "efc" (one school), "trials" (GHL), "dash" (both home page versions). */
async function refresh(what: string, school: string) {
  if (what === "efc") return await pullSchool(EFC_SCHOOLS.includes(school) ? school : "Marrickville");
  if (what === "hubwarm") {
    // Keeps each preview person's Approvals, My Day and Instructor Hub ready, so they open instantly (7am to 9pm).
    const h = Number(new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", hour: "numeric", hourCycle: "h23" }).format(new Date()));
    if (h < 7 || h > 21) return { skipped: "night" };
    const ppl = await sql`select name, phone from ama_os.staff where active and coalesce(phone, '') <> ''`, done: string[] = [];
    for (const p of ppl) { const first = String(p.name).trim().split(/\s+/)[0].toLowerCase(); if (!HUB_PREVIEW.includes(first)) continue;
      for (const kind of ["approvals", "mywork", "ihub"]) { const body = { kind }; const o = await hubCall(String(p.name), String(p.phone), body).catch(() => ({ ok: false })) as Record<string, unknown>; if (o.ok) { await hubSave(hubKey(first, body), o); done.push(first + ":" + kind); } } }
    return { warmed: done };
  }
  if (what === "efcnext") {
    // Database timer, every minute: carry on a half-done school, else refresh the school saved longest ago (if over 10 minutes old).
    const c = await sql`select key, at from ama_os.cache where key like 'efc_pull_%' or key like 'efc_school_%'`;
    const age = (k: string) => { const r = c.find((x) => x.key === k); return r ? Date.now() - new Date(r.at as string).getTime() : Infinity; };
    const busy = EFC_SCHOOLS.find((s) => age("efc_pull_" + s) < 15 * 60000);
    const due = busy ?? EFC_SCHOOLS.filter((s) => age("efc_school_" + s) > 10 * 60000).sort((x, y) => age("efc_school_" + y) - age("efc_school_" + x))[0];
    return due ? await pullSchool(due) : { idle: true };
  }
  if (what === "trials") {
    if (!(await ghlConnected())) return { skipped: true };
    const fuRows = await src("Trial follow-up"), enr = await src("Enrolments"), tb = await src("Hub trial bookings");
    const trials = await trialsFromGhl({ followup: fuRows, bookings: tb, enrolledCids: new Set(enr.map((r) => String(r["Contact ID"] ?? "").trim()).filter(Boolean)) });
    await sql`insert into ama_os.cache (key, data, at) values ('trials_live', ${sql.json({ trials } as never)}, now()) on conflict (key) do update set data = excluded.data, at = now()`;
    return { trials: trials.length };
  }
  if (what === "absent") {
    // Hub absentee rules (read-only) + parents' replies read straight from GHL.
    const rows = (await sql`select key, data from ama_os.mirror where source = 'Absentees'`).sort((a, b) => Number(String(a.key).slice(1)) - Number(String(b.key).slice(1))).map((r) => r.data as Row);
    const fams = absentFamilies(rows, await src("Holds"), await src("Cancellations"));
    const want = fams.filter(needsReplyCheck), last = await ghlConnected() ? await lastMessages([...new Set(want.map((f) => f.e164))]) : {};
    const done = want.every((f) => f.e164 in last);
    if (!done) return { incomplete: true, checked: Object.keys(last).length, of: want.length };
    let absreply = 0, absent = 0;
    for (const f of fams) { const open = needsReplyCheck(f) && replyOpen(f, last[f.e164] ?? null);
      if (open) absreply++; else if ((f.group === "office" || f.group === "check") && f.days >= 7 && f.days <= 21) absent++; }
    await sql`insert into ama_os.cache (key, data, at) values ('absent_counts', ${sql.json({ absreply, absent, families: fams.length } as never)}, now()) on conflict (key) do update set data = excluded.data, at = now()`;
    return { absreply, absent, families: fams.length, checked: want.length };
  }
  if (what === "dash") {
    const t0 = Date.now(), ms: number[] = [];
    for (const m of [true, false]) { const d = await dash(m); ms.push(Date.now() - t0);
      await sql`insert into ama_os.cache (key, data, at) values (${m ? "dash_m" : "dash_n"}, ${sql.json(d as never)}, now()) on conflict (key) do update set data = excluded.data, at = now()`; }
    return { dash: true, ms };
  }
  if (what === "probe") {
    const t: Record<string, number> = {}, t0 = Date.now(), lap = (k: string) => { t[k] = Date.now() - t0; };
    const h = await src("Holds"); lap("holds");
    const raw = await sql`select key, length(data::text) as n from ama_os.cache where key like 'efc_school_%'`; lap("sizes");
    const ms = await membersSaved({}); lap("membersSaved");
    for (const n of ["EFC live", "Cancellations", "New members", "Hub trial bookings", "Trial follow-up", "Absentees", "GHL trials"]) { await src(n); lap(n); }
    return { t, holds: h.length, sizes: raw.map((r) => r.key + ":" + r.n), members: ms ? ms.rows.length : 0 };
  }
  return { error: "unknown" };
}
async function dashFast(money: boolean) {
  const t = await sql`select data, at from ama_os.cache where key = ${money ? "dash_m" : "dash_n"}`;
  if (t.length && Date.now() - new Date(t[0].at as string).getTime() < 20 * 60000) return { ...(t[0].data as Record<string, unknown>), builtAt: new Date(t[0].at as string).toISOString() };
  return await dash(money);
}

Deno.serve(async (req) => {
  const c = cors(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: c.headers });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...c.headers, "content-type": "application/json" } });
  try {
    const rk = req.headers.get("x-amaos-refresh");
    if (rk) {
      // The refresh key is kept in memory for 10 minutes, so a timer call can be answered without waiting for the database.
      if (!refreshKeyHash || Date.now() - refreshKeyAt > 600000) {
        const want = await sql`select value from ama_os.connections where name = 'REFRESH_KEY'`;
        refreshKeyHash = want.length ? await sha256(String(want[0].value)) : ""; refreshKeyAt = Date.now();
      }
      if (!refreshKeyHash || (await sha256(rk)) !== refreshKeyHash) { refreshKeyHash = ""; return json({ ok: false, error: "Not allowed." }, 401); }
      const rb = await req.json().catch(() => ({})) as { what?: string; school?: string; from?: string };
      if (rb.from === "db") {
        // Database timers: answer at once and do the work in the background, one job after another, so the database's
        // shared web-call queue (also used by the Toolkit's timers) is never held open by a slow refresh.
        const what = String(rb.what ?? ""), school = String(rb.school ?? "");
        const job = (bgQueue = bgQueue.then(async () => {
          await sql`insert into ama_os.cache (key, data, at) values ('timer_beat', ${sql.json({ what } as never)}, now()) on conflict (key) do update set data = excluded.data, at = now()`;
          await refresh(what, school);
        }).catch((e) => console.error("refresh", what, String(e))));
        (globalThis as unknown as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime?.waitUntil(job);
        return json({ ok: true, started: what }, 202);
      }
      return json({ ok: true, ...(await refresh(String(rb.what ?? ""), String(rb.school ?? ""))) });
    }
    const g = await requireStaff(req);
    if (!g.staff) return json({ ok: false, error: g.error }, g.status ?? 403);
    const me = g.staff, money = MONEY.includes(me.first);
    const b = await req.json().catch(() => ({})) as { act?: string; q?: string };
    if (b.act === "autos") {
      const sw = await sql`select value, set_by, set_at from ama_os.settings where key = 'sending'`;
      const rows = await sql`select key, name, what, hub_trigger, owner, moved_at, moved_by from ama_os.automations order by owner desc, name`;
      return json({ ok: true, sending: sw[0]?.value ?? "off", list: rows });
    }
    if (b.act === "hub") {
      // 27 Nov 2026: hub actions run AS this staff member through the hub (its permissions, texts and logs apply). Preview list only.
      // Screens that only read (approvals, My Day...) answer instantly from this person's last copy; the screen then asks again with fresh: true.
      if (!HUB_PREVIEW.includes(me.first)) return json({ ok: false, error: "Not switched on for you yet." }, 403);
      const body = (b as { body?: Record<string, unknown> }).body ?? {}, kind = String(body.kind ?? ""), fresh = !!(b as { fresh?: boolean }).fresh;
      if (!HUB_KINDS.includes(kind)) return json({ ok: false, error: "Not available in AMA OS yet." });
      if (kind === "failpay" && !MONEY.includes(me.first)) return json({ ok: false, error: "Only Mark, Sarah, Hakan, Ridvan and Busra see payments." }, 403);
      if ((kind.startsWith("pay") || kind === "headleave") && !["mark", "sarah", "hakan", "ridvan", "busra"].includes(me.first)) return json({ ok: false, error: "Roster, leave and pay is for Mark, Sarah, Hakan, Ridvan and Busra." }, 403);
      if (kind.startsWith("epb") && !["mark", "sarah", "hakan", "ridvan"].includes(me.first)) return json({ ok: false, error: "Employment packs are for Mark, Sarah, Hakan and Ridvan." }, 403);
      if (kind.startsWith("efc") && (body.run || body.sync)) return json({ ok: false, error: "Running the EFC checks again is still done in the hub. The checks run every night." }); // heavy jobs stay in the hub
      if (kind === "efcuse" && !["mark", "sarah", "hakan", "ridvan"].includes(me.first)) return json({ ok: false, error: "Enrolled vs paying is for Mark, Sarah, Hakan and Ridvan." }, 403);
      if (kind === "staff" && body.act !== "me") return json({ ok: false, error: "Staff management is still in the hub." }); // AMA OS only reads your own profile
      const ttl = body.act && body.act !== "list" && !(HUB_READ_ACTS[kind] ?? []).includes(String(body.act)) ? 0 : HUB_READ[kind];
      if (ttl) {
        const ck = hubKey(me.first, body), hit = await sql`select data, at from ama_os.cache where key = ${ck}`;
        const age = hit.length ? Date.now() - new Date(hit[0].at as string).getTime() : Infinity;
        // 27 Nov 2026: always show the saved copy at once (the screen then asks again with fresh: true and redraws if anything changed).
        if (!fresh && hit.length && age < Math.max(ttl, 86400) * 1000) {
          return json({ ...(hit[0].data as Record<string, unknown>), cachedAt: new Date(hit[0].at as string).toISOString() });
        }
        const out = await hubCall(me.name, String(me.login ?? ""), body); if (out.ok) await hubSave(ck, out);
        return json(out);
      }
      const out = await hubCall(me.name, String(me.login ?? ""), body);
      if ((HUB_LOOKUP[kind] ?? []).includes(String(body.act)) || kind === "epbtoken" || kind === "trialinfo" || (kind === "headleave" && body.preview) || (kind === "camplink" && body.preview)) return json(out); // a look-up, not a change
      if (!["trialslots"].includes(kind)) await sql`insert into ama_os.audit (actor, actor_login, role, action, detail) values (${me.name}, ${me.login}, ${me.role}, ${"hub " + kind}, ${sql.json({ body: kind === "ppf" && body.data ? { ...body, data: "(their goals)" } : Array.isArray(body.files) ? { ...body, files: (body.files as { name?: string }[]).map((f) => f.name) } : body, ok: !!out.ok, error: out.error ?? null } as never)})`;
      // 27 Nov 2026: saved copies are kept (no longer cleared), so the next screen still opens at once; it refreshes itself straight after.
      return json(out);
    }

    if (b.act === "checksave") {
      // Preview on Mark's login only (26 Nov 2026). Saved by the hub, exactly as if done in the hub.
      if (!HUB_PREVIEW.includes(me.first)) return json({ ok: false, error: "Not switched on for you yet." }, 403);
      const c = b as { id?: string; attended?: string; rec?: string; notes?: string };
      const id = String(c.id ?? ""), att = String(c.attended ?? ""), rec = c.rec == null ? null : String(c.rec), notes = c.notes == null || String(c.notes).trim() === "" ? null : String(c.notes).slice(0, 1000);
      if (!["Attended", "Absent", "Rebooked"].includes(att)) return json({ ok: false, error: "Choose Attended, Absent or Rebooked." });
      if (rec !== null && !["", "Yes", "No", "Later"].includes(rec)) return json({ ok: false, error: "Bad recommendation value." });
      const tl = await sql`select data from ama_os.cache where key = 'trials_live'`;
      const list = tl.length ? (tl[0].data as { trials: Row[] }).trials : [], tr = list.find((x) => String(x.id) === id);
      if (!tr || String(id).charAt(0) === "W") return json({ ok: false, error: "That trial isn't in the list any more. Refresh and try again." });
      const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(new Date(tr.t as number));
      const key = Deno.env.get("AMAOS_SYNC_KEY") ?? ""; if (!key) return json({ ok: false, error: "AMA OS can't reach the hub yet (no sync key)." });
      const r = await fetch(HUB_EXEC, { method: "POST", headers: { "content-type": "application/json" }, redirect: "follow",
        body: JSON.stringify({ kind: "amaoswrite", key, who: me.name, act: "checksave", id, loc: tr.loc, date, attended: att, rec, notes }) });
      const out = await r.json().catch(() => ({ ok: false, error: "The hub didn't answer properly (" + r.status + ")." })) as { ok?: boolean; error?: string };
      await sql`insert into ama_os.audit (actor, actor_login, role, action, detail) values (${me.name}, ${me.login}, ${me.role}, 'trial check', ${sql.json({ id, date, loc: tr.loc, attended: att, rec, ok: !!out.ok, error: out.error ?? null } as never)})`;
      if (!out.ok) return json({ ok: false, error: out.error || "The hub couldn't save it." });
      // Show it straight away: update the saved trial list and rebuild the home page.
      tr.att = att; if (rec !== null) tr.rec = rec;
      if (tr.status !== "Enrolled") tr.status = rec === "Yes" || (rec === null && tr.status === "Rec sent") ? "Rec sent" : att;
      await sql`update ama_os.cache set data = ${sql.json({ trials: list } as never)} where key = 'trials_live'`;
      await refresh("dash", "");
      return json({ ok: true, status: tr.status });
    }
    if (b.act === "list") return json(await list(String((b as { kind?: string }).kind ?? ""), money, MGMT.includes(me.first) || me.role === "owner"));
    if (b.act === "find") {
      const q = String(b.q ?? "").trim().slice(0, 60);
      if (q.replace(/\s/g, "").length < 2) return json({ ok: false, error: "Type at least 2 letters, or a mobile number." });
      await sql`insert into ama_os.audit (actor, actor_login, role, action, detail) values (${me.name}, ${me.login}, ${me.role}, 'lookup', ${sql.json({ q })})`;
      return json({ ok: true, ...(await find(q, money)) });
    }
    return json({ ok: true, me: { name: me.name, role: me.role, check: HUB_PREVIEW.includes(me.first), hub: HUB_PREVIEW.includes(me.first) }, ...(await dashFast(money)) });
  } catch (e) {
    return json({ ok: false, error: "Something went wrong. Please try again.", detail: String((e as Error).message ?? e).slice(0, 200) }, 500);
  }
});
