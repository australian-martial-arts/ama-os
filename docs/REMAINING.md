# AMA OS: what still has to move from the hub

Written 27 Nov 2026 from a full read of the live hub code (apps-script/, identical to the live Apps Script project, hub v497).
Tick items off here as they move. Cut-over from the hub: from 15 Dec 2026 (build now, hold the switch-over).

How AMA OS works until cut-over: every change made in AMA OS is saved by the hub, as the signed-in staff member
(`amaos-dash` act `hub` -> hub `amaosWrite_` act `route`, allow-list `AMAOS_ROUTE`). So the hub's own permissions,
texts, notes and logs apply, and the hub stays up to date. Reads show the last saved copy, then refresh.

## 1. Hub screens not in AMA OS at all
- [ ] Little Dragons grading (nominations, approvals, master belts) - hub kind `ldg`
- [ ] Prep sessions and Prep check-in - `prepadd`, `preplink`, `preppaid`, `prepsess`, `prepview`
- [ ] Staff settings (roles, schools, record types, pathways, class audit lines) - `staffcfg`
- [ ] Community partners - `partners`
- [ ] Parents' Night Out - `pno`
- [ ] Community Growth Day - `cgd`
- [ ] Christmas roster - `xmashub`
- [ ] Executive meeting page - `execget`, `execnote`, `execaction`, `execemail`
- [ ] Find a family: family card, notes, documents, photos, contact log, student card - `family`, `famsearch`, `famnote`, `docopen`, `photos`, `clog`, `stucard`
- [ ] Membership changes (forms and signing) - `mclist`, `mcstart`, `mcdone`
- [ ] Member Hub as staff see it - `mhub`, `mvid` (move videos)
- [ ] Instructor Hub tabs: onboarding (`ionb`), move reviews (`mvid`), class audits (`caudit`), My team (`staff` beyond `me`)
- [ ] Sales, Marketing and Retention dashboards (AMA OS has link pages only) - `retention`, `mgmt`, `mgmtextra`, `mgmtpeople`, `ytd`, `gmoney`, `gnums`
- [x] EFC tools (27 Nov: EFC checks screen; Attendance and Add missed class on the family card. Running the checks again now stays in the hub) - `efcchecks`, `efcuse`, `efcatt`, `efclive`

## 2. In AMA OS but view only (the buttons are still in the hub)
- [~] Trials / Close the sale actions (27 Nov: Close the sale, follow-up outcomes, details, confirmed, 24-hour call, change class or time, remove done; still hub: confirm + full fact find, recommendation tool, resend reports, win-back) - `followups`, `followupdone`, `trialff`, `trialmove`, `trialcallback`, `trialcall24`, `trialremove`, `trialinfo`, `trialinfoev`, `tcresend`, `tcabsenttext`, `winback`, `chaselist`, `chaseaction`, `reclog`, `reclast`
- [x] Enquiry replies inbox (27 Nov, in Trials) - `replylist`, `replydone`, `replyundo`
- [x] New members actions (27 Nov) - `nmlist`, `nmaction`
- [x] Absent follow-up actions (27 Nov: all stages, outcomes, sign-in reminder, reply by text, training-not-signing-in) - `abslist`, `absaction`, `abstext`, `abslogin`, `absnsi`, `absnsilist`
- [x] Holds and Cancels actions (27 Nov: list, resend, certificate, done in EFC, restarted, extend, cancelling instead; cancels to action and forms sent; approvals already in Approvals) - `holdlist`, `holdaction`, `holdextend`, `holdrecord`, `cxlist`, `cxaction`, `cxdone`, `cxfast`, `cxlookup`, `cxsent`, `cancel`, `reqadd`, `reqhistory`
- [x] Referrals actions (27 Nov) - `refaction`
- [x] Gradings actions (27 Nov: decisions, technique help, fix in EFC. Grading texts stay in Tate's Toolkit only) - `gradelist`, `gradesave`, `gradesend`, `gradefix`, `gradepace`
- [ ] Birthday parties: links, settings, suppliers - `partylinks`, `partysettings`, `partysupplier`
- [~] Holiday camp actions (27 Nov: staff roster approve / remove / swap, follow-ups; still hub: moving a child's days, refunds, Square) - `campapprove`, `campmove`, `campswap`, `camprefund`, `campsquare`, `campupdate`
- [x] Private lessons actions (27 Nov: book, paid / no show / cancel, availability; adding instructors still hub) - `pvbook`, `pvstatus`, `pvaddinst`, `pvavail`
- [ ] Shop: sales, checkout, cancel, items - `shopsales`, `shopcheckout`, `shopcancel`, `shopstatus`, `stockitem`
- [ ] My Day call queues and to-do list - `myday`, `todo`
- [ ] Promotions actions - `promo`
- [ ] Staff management (profiles, records, warnings, lateness) - `staff`
- [ ] Media opt-outs and Students: lists only

Done so far (27 Nov): Approvals, My Day work list, After-trial check, Requests to log, Book a trial, Hub change requests,
Extra shifts, Failed payments, AMA Stars, Absentee videos (view), Live attendance, Referrals (view), Birthday parties
(stages, checklist), Private lessons (view), Holiday camp (view), Shop and stock, AMA Playbook, Instructor Hub (Today,
Curriculum, My development, My availability, Grow and earn), My review calendar and PPF, Training and sign-offs,
Employment packs, Roster leave and pay, Management dashboard (same people as the hub).

## 3. Automatic jobs that run only in the hub
Rebuild in AMA OS, then switch off in the hub on the same day, so nothing is ever sent twice.
- [ ] Trial check texts (5 min) - `sendTrialChecks`
- [ ] Booking reminder sends - `sendDue`, `sendDueTick`
- [ ] Calendar sync (hourly) - `syncCalendars`
- [ ] Enquiry alerts (15 min) - `enquiryAlerts`
- [ ] Hold care (daily) - `holdCareDaily`
- [ ] Cancellation care (hourly) - `cxCareHourly` (also runs the EFC subscription refresh)
- [ ] Referral texts (daily) - `refDaily`
- [ ] Absent auto-texts (10am) - `absAutoSend`
- [ ] Staff daily report - `staffDailyReport`
- [ ] Later starts (daily) - `laterDaily`
- [ ] PPF reminders - `ppfTick`; Prep reminders - `prepReminders`
- [ ] Camp paid check - `campPaidTick`; Grading sync - `gnSync`; Retention build - `retBuildDaily`
- [ ] Management build and Monday report - `hubMgmtWarm`, `mgmtSendWeekly`, `mgmtSendCountReminder`
- [ ] Payroll Monday email, Deputy clock-on watcher, Deputy autopilot - `payClockTick`, `payClockTick2`
- [ ] Late follow-up - `lateHuDaily`; Stars - `starsTick`
- [ ] Mail-in (reads emails, e.g. notice emails) - `mailInTick`
- [ ] The 10-minute run - `mydayWarm` (famSrcWarm, staffQueueFlush, bbcfPull, ldgAskTick, shopSweep, shopWebTick, hubBackupTick, deputyTick, geoTick, photoTick, trimTick, efcSyncMorningTick, spkTick, amaosTrialsPush, amaosLiveTick)
- [ ] History import (5am) - `importHistory`
- Tate's Toolkit jobs stay as they are: `cbSkipSync` and the Black-belt-prep calls. Never break: amaSso_, cbSkipSync, cbreply, bbcalls, bbcallout, AMA_SSO_SECRET, CB_SKIP_KEY, CB_REPLY_KEY, PREP_HUB_KEY.

## 4. Public pages and links served by the hub
Links already sent to families point at the hub: move them with redirects, or keep them in the hub after cut-over.
- [ ] Holiday camp booking - `campinfo`, `campbook`, `campstaff`, `campsquare`
- [ ] Party booking and requests - `partypublic`, `partyrequest`, `partystaff`
- [ ] Prep session booking - `prepinfo`, `preplist`, `prepbook`, `prepdetails`
- [ ] Hold and cancellation agreement signing - `holdsign`, `holddoc`, `cxsign`, `cxdoc`
- [ ] Membership change signing - `mcsign`, `mcdoc`
- [ ] Referral join page - `joinref`, `joindata`
- [ ] Staff PIN login and reset - `login`, `pinreset`
- [ ] Toolkit sign-in (Tate) - `amasso`
- [ ] GoHighLevel webhooks - `reply`, `cbreply` (Tate)
- [ ] Move video data - `viddata`; student info - `stuinfo`; page scripts - `pagejs`; Pack Builder - `epbprefill`, `epbupload`

## 4b. Outside systems the hub writes to (27 Nov audit)
AMA OS never writes to these itself: every save goes through the hub, as the signed-in staff member, so the hub's keys and rules are used.
- EFC: Add missed class and Live attendance check-in (book the class + mark present). Everything else in EFC (holds, cancels, packages) is still done by hand in EFC; the hub only checks it.
- Deputy: roster shifts (add, change, delete), leave, extra shifts, staff contacts, new staff from Employment packs; automatic: hours sync, geofence and trim jobs, Deputy autopilot.
- GoHighLevel: texts and emails, notes, tags, contact updates, trial bookings and moves, calendar events, opportunities.
- Square: holiday camp payments. Stripe: shop checkout links. Google: Drive (signed forms, photos, videos, backups), Gmail (payroll and holds emails), Calendar (trial calendar sync).
- Anthropic: move video feedback. Tate's Toolkit: skip sync, replies, Black-belt-prep calls (never break).

## 5. Data from the source
- [ ] Holds, cancels, follow-ups, new members and absent counts still come from the hub's copy. Read them from EFC / GHL directly.
  (Trials and members already come live from GHL and EFC.)

## 5b. Summer 2027 holiday camp (Laurie's brief, 27 Nov; Mark approved all six points)
- [x] Hub v503: no Fri 18 Dec; $80 a day, $70 a day for 5+ days (per child); no early bird; urgency per day (0-8 Book now, 9-14 Filling up, 15+ Only a few spots left); UTM source saved; admin "send booking link" text (OFF until Mark approves wording); Paid cash (walk-ins only)
- [x] AMA OS camp: Bookings (Paid cash) and Booking link tabs
- [x] Themes: Friday = Superhero and Nerf Wars Day, Wednesday = Kama Day (hub v506)
- [~] New summer landing page (preview built 27 Nov: site/camp/summer-2027.html, on Mark for approval; then into GHL at /holiday-camp/summer-2027, photos to GHL media, CAMP.pageUrl to the new address) (sun and beach look, Laurie's Drive photos, website video, urgency on hover, 48-hour refund terms); /holiday-camp forwards to it; preview to Mark first
- [ ] Parent confirmation (bring a friend; free trial prompt for non-members), day-before reminder, staff new-booking alert: drafts to Mark first
- [ ] Check Square, then go live (CAMP.live)
- [x] Print requests (hub v504 + AMA OS); Christmas pause 21 Dec - 10 Jan on all "we miss you" texts (absentee day 9/30, We missed you button, win-back)

## 6. New feature requests
- [ ] Member Hub news cards (Mark, 27 Nov): staff post a card to families in the Member Hub, e.g. "Buddy week coming - click here to book your friend",
      with a button that opens the trial booking for a friend (counts as a referral). Choose which schools/programs see it and when it shows and ends.
      Builds on the Member Hub, so it comes with or after moving the Member Hub.

## 7. Other open items
- [ ] Switch previews on for the whole team after Mark and Tate test (`HUB_PREVIEW` in amaos-dash)
- [ ] Rotate the hub secret value (after mapping the GHL workflows that send it); fix the public rec page that exposes it
- [ ] Decide whether the GitHub repo should be private
- [ ] Grading photos, Member Hub parent sign-in, remove probe code
- [ ] Speed: screens that first open slowly (see below)

## Speed notes
A screen that only reads opens from AMA OS's saved copy at once, then refreshes in the background. It is slow only
when there is no saved copy yet (first open, or after a save clears your copies): then AMA OS has to ask the hub,
and the hub takes 3-30 seconds (Google Apps Script plus EFC, GHL and Deputy calls). Fixes: keep more screens warm,
keep copies after a save for screens the save did not touch, and read straight from the source (section 5).
