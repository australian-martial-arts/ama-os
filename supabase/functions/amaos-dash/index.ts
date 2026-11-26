// amaos-dash: read-only dashboard and family lookup for AMA OS, built from the nightly copy of the hub (ama_os.mirror).
// Signed-in AMA OS staff only (owners, full-access admins and admins also need their second step).
// Uses the ama_os_app database login only. Reads nothing from EFC, GHL or the Toolkit, and writes only the audit log.
// EFC money (next invoice amounts, overdue amounts) is shown to Mark, Sarah, Hakan, Ridvan and Busra only (Mark's rule).
import { cors, requireStaff, sql } from "../_shared/amaos.ts";
import { ghlConnected, trialsFromGhl } from "../_shared/ghl.ts";

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
async function src(name: string): Promise<Row[]> {
  const hit = CACHE.get(name); if (hit && Date.now() - hit.at < 60000) return hit.rows;
  const rows = (await sql`select data from ama_os.mirror where source = ${name}`).map((r) => r.data as Row);
  CACHE.set(name, { at: Date.now(), rows }); return rows;
}

async function dash(money: boolean) {
  const today = sydToday(), d30 = addDays(today, -30), d7 = addDays(today, 7);
  const [gt, efc, holds, cx, nm, tb, tf, ab, runs] = await Promise.all([
    src("GHL trials"), src("EFC live"), src("Holds"), src("Cancellations"), src("New members"), src("Hub trial bookings"), src("Trial follow-up"), src("Absentees"),
    sql`select source, max(at) as at from ama_os.mirror_runs group by source`,
  ]);
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
  if (await ghlConnected()) {
    try { const [fuRows, enr] = await Promise.all([src("Trial follow-up"), src("Enrolments")]);
      trials = await trialsFromGhl({ followup: fuRows, bookings: tb, enrolledCids: new Set(enr.map((r) => String(r["Contact ID"] ?? "").trim()).filter(Boolean)) }) as unknown as Row[]; trialsLive = true;
    } catch (e) { console.log("ghl trials: " + (e as Error).message); }
  }
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
  const needs = {
    holds: holds.filter((r) => !/signed|declin|active|resum|no freeze|done|closed|cancel/i.test(String(r["Status"] ?? ""))).length,
    cancels: cx.filter((r) => !/done|actioned|withdr|stay|retain|closed|complete|cancelled request|rejoin/i.test(String(r["Status"] ?? ""))).length,
    newmem: nm.filter((r) => { const d = ymd(r["Start date"], today); return d && d >= d90 && !/done|complete|closed|left/i.test(String(r["Status"] ?? "")) && !yes(r["Done"]); }).length,
    absent: absOpen,
  };
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
  const trialsAt = trialsLive ? new Date().toISOString() : iso((runs.find((r) => r.source === "GHL trials") || {}).at);
  return {
    today, syncedAt: at, schools: SCHOOLS, by: { ...S, holdsNow: hBy },
    totals: Object.fromEntries(Object.entries({ ...S, holdsNow: hBy }).map(([k, v]) => [k, Object.values(v).reduce((a, b) => a + b, 0)])),
    absenteesOpen: absOpen, weeks, trials, trialsAt, trialsLive, needs, week,
    upcoming: upcoming.sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(0, 60),
    money: money ? { overdueFamilies: overdue, overdueTotal: Math.round(overdueAmt), nextInvoicesTotal: Math.round(nextAmt) } : null,
  };
}

// Read-only lists of the critical flows (side-by-side checks before the switch-over).
const LISTS: Record<string, { src: string; date: string; school: string; cols: string[]; money?: string[] }> = {
  holds: { src: "Holds", date: "Logged at", school: "Trains at", cols: ["Logged at", "Status", "Account holder", "Mobile", "Students", "Trains at", "Reason", "Freeze starts", "Freeze ends", "Weeks", "Taken by", "Approved by", "Signed at", "EFC actioned at", "Resumed at", "Notes"], money: ["Weekly rate"] },
  cancels: { src: "Cancellations", date: "Logged at", school: "Trains at", cols: ["Logged at", "Status", "Account holder", "Mobile", "Students", "Trains at", "Reason", "In their words", "Notice ends", "Last class", "Taken by", "Approved by", "Signed at", "EFC actioned at", "Exit rating", "Rejoined", "Notes"], money: ["Uniform balance"] },
  newmembers: { src: "New members", date: "Start date", school: "School", cols: ["Start date", "Status", "Family", "Mobile", "Students", "School", "Done", "Handled by", "Notes", "Updated at"] },
  followup: { src: "Trial follow-up", date: "Trial date", school: "Location", cols: ["Trial date", "Trial time", "Location", "Child", "Class", "Parent", "Mobile", "Attended", "Recommendation sent", "Follow-up", "Next follow-up", "Followed up by", "Follow-up note", "Notes"] },
};
async function list(kind: string, money: boolean) {
  const L = LISTS[kind]; if (!L) return { ok: false, error: "Unknown list." };
  const today = sydToday(), rows = await src(L.src), cols = money && L.money ? L.cols.concat(L.money) : L.cols;
  const out = rows.map((r) => ({ ...pick(r, cols), _d: ymd(r[L.date], today), _s: school(r[L.school]) }))
    .sort((a, b) => String(b._d).localeCompare(String(a._d))).slice(0, 800);
  return { ok: true, kind, today, cols, total: rows.length, rows: out };
}

const KID = ["School", "Student", "Age", "Groups", "Last attended", "Days since", "Classes this month", "Total classes", "Enrolled on", "Hub hold", "Flags", "Reference"];
async function find(q: string, money: boolean) {
  const today = sydToday(), efc = await src("EFC live"), qd = q.replace(/\D/g, ""), ql = q.toLowerCase();
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
  const [holds, cx, tb, nm, docs, ab] = await Promise.all([src("Holds"), src("Cancellations"), src("Hub trial bookings"), src("New members"), src("Member docs"), src("Absentees")]);
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
  return { today, families, more: fams.size > list.length };
}

Deno.serve(async (req) => {
  const c = cors(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: c.headers });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...c.headers, "content-type": "application/json" } });
  try {
    const g = await requireStaff(req);
    if (!g.staff) return json({ ok: false, error: g.error }, g.status ?? 403);
    const me = g.staff, money = MONEY.includes(me.first);
    const b = await req.json().catch(() => ({})) as { act?: string; q?: string };
    if (b.act === "list") return json(await list(String((b as { kind?: string }).kind ?? ""), money));
    if (b.act === "find") {
      const q = String(b.q ?? "").trim().slice(0, 60);
      if (q.replace(/\s/g, "").length < 2) return json({ ok: false, error: "Type at least 2 letters, or a mobile number." });
      await sql`insert into ama_os.audit (actor, actor_login, role, action, detail) values (${me.name}, ${me.login}, ${me.role}, 'lookup', ${sql.json({ q })})`;
      return json({ ok: true, ...(await find(q, money)) });
    }
    return json({ ok: true, me: { name: me.name, role: me.role }, ...(await dash(money)) });
  } catch (e) {
    return json({ ok: false, error: "Something went wrong. Please try again.", detail: String((e as Error).message ?? e).slice(0, 200) }, 500);
  }
});
