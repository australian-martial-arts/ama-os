-- 26 Nov 2026 (Mark): nothing is ever sent twice while things move from the hub to AMA OS.
-- Every automation that sends a text or email, or writes to GHL, EFC or calendars, has ONE owner: 'hub' or 'amaos'.
-- AMA OS may only run an automation it owns, AND only while the master sending switch is on (off until Mark turns it on).
-- Moving one = turn it off in the hub and set owner 'amaos' here in the same step, after Mark approves.
create table if not exists ama_os.settings (key text primary key, value text not null, set_by text, set_at timestamptz not null default now());
insert into ama_os.settings (key, value, set_by) values ('sending', 'off', 'system') on conflict (key) do nothing;

create table if not exists ama_os.automations (
  key text primary key, name text not null, what text not null, hub_trigger text, owner text not null default 'hub' check (owner in ('hub', 'amaos')),
  moved_at timestamptz, moved_by text);
insert into ama_os.automations (key, name, what, hub_trigger) values
  ('trial_staff_list', 'Daily trial list to rostered staff', 'SMS', 'sendDue / sendDueTick'),
  ('trial_checks', 'After-trial check texts to staff', 'SMS', 'sendTrialChecks'),
  ('trial_family_texts', 'Trial booking, day-before and promotion texts to families', 'SMS + GHL notes', 'trial booking / promo sends'),
  ('enquiry_alerts', 'New enquiry alerts', 'SMS / email', 'enquiryAlerts'),
  ('close_sale_resend', 'Close the sale: join link resends', 'SMS', 'CHASE resend'),
  ('absentee_texts', 'Absentee texts (7, 30 days and last try)', 'SMS', 'absAutoSend'),
  ('new_member_texts', 'New member texts (day 7, 30, 90)', 'SMS', 'NM texts'),
  ('winback_texts', 'Win-back texts to cancelled families', 'SMS', 'WINBACK'),
  ('hold_care', 'Hold agreements, sign links and care texts', 'SMS + email', 'holdCareDaily'),
  ('cancel_care', 'Cancellation confirmations, sign links and care texts', 'SMS + email', 'cxCareHourly + CANCEL.emailParents'),
  ('referral_daily', 'Referral thank-you reminders', 'SMS', 'refDaily'),
  ('later_starts', 'Later-start reminders', 'SMS', 'laterDaily'),
  ('prep_reminders', 'Colour belt prep confirmations and reminders', 'SMS', 'prepReminders'),
  ('camp_texts', 'Holiday camp texts', 'SMS', 'campPaidTick'),
  ('stars', 'AMA Stars updates', 'SMS / ledger', 'starsTick'),
  ('staff_reports', 'Daily team report, weekly and count reminders', 'Email / SMS', 'staffDailyReport, mgmtSendWeekly, mgmtSendCountReminder'),
  ('late_huddle', 'Late / huddle alerts', 'SMS', 'lateHuDaily'),
  ('clock_alerts', 'Deputy clock-on alerts', 'SMS', 'payClockTick'),
  ('calendar_sync', 'Trial calendars in Google Calendar', 'Calendar writes', 'syncCalendars'),
  ('efc_writes', 'Anything written to EFC (bookings, check-ins, holds, cancels)', 'EFC writes', 'efc write key'),
  ('ghl_writes', 'Anything written to GHL (notes, tags, stages)', 'GHL writes', 'ghlPost_')
on conflict (key) do nothing;
revoke all on ama_os.settings, ama_os.automations from public;
