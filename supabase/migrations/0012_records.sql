-- 26 Nov 2026 (Mark): AMA OS's own records for the critical flows. Until switch-over, each nightly hub copy is imported
-- here automatically (source = 'hub'). Records created in AMA OS (source = 'amaos') are never overwritten by a hub import.
-- Every record keeps the full original row in "data", plus typed columns for searching and sorting.

create or replace function ama_os.safe_date(t text) returns date language plpgsql immutable as $$
declare m text[];
begin
  if t is null or btrim(t) = '' then return null; end if;
  m := regexp_match(t, '^(\d{4})-(\d{2})-(\d{2})'); if m is not null then return make_date(m[1]::int, m[2]::int, m[3]::int); end if;
  m := regexp_match(t, '(\d{1,2})/(\d{1,2})/(\d{2,4})'); if m is not null then return make_date(case when length(m[3]) = 2 then 2000 + m[3]::int else m[3]::int end, m[2]::int, m[1]::int); end if;
  return null;
exception when others then return null;
end $$;
create or replace function ama_os.mob9(t text) returns text language sql immutable as $$ select right(regexp_replace(coalesce(t, ''), '\D', '', 'g'), 9) $$;

create table if not exists ama_os.holds (
  id text primary key, logged_on date, status text, account_holder text, mobile9 text, students text, school text,
  freeze_starts date, freeze_ends date, data jsonb not null, source text not null default 'hub', updated_at timestamptz not null default now());
create table if not exists ama_os.cancellations (
  id text primary key, logged_on date, status text, account_holder text, mobile9 text, students text, school text,
  last_class date, notice_ends date, data jsonb not null, source text not null default 'hub', updated_at timestamptz not null default now());
create table if not exists ama_os.trial_followups (
  id text primary key, trial_date date, school text, child text, parent text, mobile9 text, contact_id text, attended text, rec_sent text,
  data jsonb not null, source text not null default 'hub', updated_at timestamptz not null default now());
create table if not exists ama_os.new_members (
  id text primary key, start_date date, status text, family text, mobile9 text, students text, school text,
  data jsonb not null, source text not null default 'hub', updated_at timestamptz not null default now());
create table if not exists ama_os.enrolments (
  id text primary key, enrolled_on date, school text, student text, mobile9 text, contact_id text,
  data jsonb not null, source text not null default 'hub', updated_at timestamptz not null default now());
create table if not exists ama_os.trial_bookings (
  id text primary key, booked_at date, booked_by text, event_id text, contact_id text, parent text, mobile9 text, child text, school text,
  data jsonb not null, source text not null default 'hub', updated_at timestamptz not null default now());
create index if not exists holds_mobile9 on ama_os.holds (mobile9);
create index if not exists cancellations_mobile9 on ama_os.cancellations (mobile9);
create index if not exists trial_followups_mobile9 on ama_os.trial_followups (mobile9);
create index if not exists new_members_mobile9 on ama_os.new_members (mobile9);
create index if not exists enrolments_contact on ama_os.enrolments (contact_id);
create index if not exists trial_bookings_event on ama_os.trial_bookings (event_id);

-- Import one hub tab from the nightly copy (called by amaos-sync after each tab arrives).
create or replace function ama_os.import_mirror(src text) returns int language plpgsql as $$
declare n int := 0;
begin
  if src = 'Holds' then
    insert into ama_os.holds (id, logged_on, status, account_holder, mobile9, students, school, freeze_starts, freeze_ends, data)
    select coalesce(nullif(data->>'Request ID', ''), 'hub-row:' || key), ama_os.safe_date(data->>'Logged at'), data->>'Status', data->>'Account holder', ama_os.mob9(data->>'Mobile'),
           data->>'Students', data->>'Trains at', ama_os.safe_date(data->>'Freeze starts'), ama_os.safe_date(data->>'Freeze ends'), data
    from (select distinct on (coalesce(nullif(data->>'Request ID', ''), 'hub-row:' || key)) key, data from ama_os.mirror where source = src order by coalesce(nullif(data->>'Request ID', ''), 'hub-row:' || key), synced_at desc) m
    on conflict (id) do update set logged_on = excluded.logged_on, status = excluded.status, account_holder = excluded.account_holder, mobile9 = excluded.mobile9, students = excluded.students,
      school = excluded.school, freeze_starts = excluded.freeze_starts, freeze_ends = excluded.freeze_ends, data = excluded.data, updated_at = now() where ama_os.holds.source = 'hub';
  elsif src = 'Cancellations' then
    insert into ama_os.cancellations (id, logged_on, status, account_holder, mobile9, students, school, last_class, notice_ends, data)
    select coalesce(nullif(data->>'Request ID', ''), 'hub-row:' || key), ama_os.safe_date(data->>'Logged at'), data->>'Status', data->>'Account holder', ama_os.mob9(data->>'Mobile'),
           data->>'Students', data->>'Trains at', ama_os.safe_date(data->>'Last class'), ama_os.safe_date(data->>'Notice ends'), data
    from (select distinct on (coalesce(nullif(data->>'Request ID', ''), 'hub-row:' || key)) key, data from ama_os.mirror where source = src order by coalesce(nullif(data->>'Request ID', ''), 'hub-row:' || key), synced_at desc) m
    on conflict (id) do update set logged_on = excluded.logged_on, status = excluded.status, account_holder = excluded.account_holder, mobile9 = excluded.mobile9, students = excluded.students,
      school = excluded.school, last_class = excluded.last_class, notice_ends = excluded.notice_ends, data = excluded.data, updated_at = now() where ama_os.cancellations.source = 'hub';
  elsif src = 'Trial follow-up' then
    insert into ama_os.trial_followups (id, trial_date, school, child, parent, mobile9, contact_id, attended, rec_sent, data)
    select coalesce(nullif(data->>'Event ID', ''), 'hub-row:' || key), ama_os.safe_date(data->>'Trial date'), data->>'Location', data->>'Child', data->>'Parent', ama_os.mob9(data->>'Mobile'),
           data->>'Contact ID', data->>'Attended', data->>'Recommendation sent', data
    from (select distinct on (coalesce(nullif(data->>'Event ID', ''), 'hub-row:' || key)) key, data from ama_os.mirror where source = src order by coalesce(nullif(data->>'Event ID', ''), 'hub-row:' || key), synced_at desc) m
    on conflict (id) do update set trial_date = excluded.trial_date, school = excluded.school, child = excluded.child, parent = excluded.parent, mobile9 = excluded.mobile9, contact_id = excluded.contact_id,
      attended = excluded.attended, rec_sent = excluded.rec_sent, data = excluded.data, updated_at = now() where ama_os.trial_followups.source = 'hub';
  elsif src = 'New members' then
    insert into ama_os.new_members (id, start_date, status, family, mobile9, students, school, data)
    select coalesce(nullif(data->>'Key', ''), 'hub-row:' || key), ama_os.safe_date(data->>'Start date'), data->>'Status', data->>'Family', ama_os.mob9(data->>'Mobile'), data->>'Students', data->>'School', data
    from (select distinct on (coalesce(nullif(data->>'Key', ''), 'hub-row:' || key)) key, data from ama_os.mirror where source = src order by coalesce(nullif(data->>'Key', ''), 'hub-row:' || key), synced_at desc) m
    on conflict (id) do update set start_date = excluded.start_date, status = excluded.status, family = excluded.family, mobile9 = excluded.mobile9, students = excluded.students,
      school = excluded.school, data = excluded.data, updated_at = now() where ama_os.new_members.source = 'hub';
  elsif src = 'Enrolments' then
    insert into ama_os.enrolments (id, enrolled_on, school, student, mobile9, contact_id, data)
    select 'hub:' || md5(coalesce(data->>'Contact ID', '') || '|' || coalesce(data->>'Student name', '') || '|' || coalesce(data->>'Enrolled date', '') || '|' || key),
           ama_os.safe_date(data->>'Enrolled date'), data->>'Location', data->>'Student name', ama_os.mob9(data->>'Mobile'), data->>'Contact ID', data
    from (select distinct on ('hub:' || md5(coalesce(data->>'Contact ID', '') || '|' || coalesce(data->>'Student name', '') || '|' || coalesce(data->>'Enrolled date', '') || '|' || key)) key, data from ama_os.mirror where source = src order by 'hub:' || md5(coalesce(data->>'Contact ID', '') || '|' || coalesce(data->>'Student name', '') || '|' || coalesce(data->>'Enrolled date', '') || '|' || key), synced_at desc) m
    on conflict (id) do update set enrolled_on = excluded.enrolled_on, school = excluded.school, student = excluded.student, mobile9 = excluded.mobile9, contact_id = excluded.contact_id,
      data = excluded.data, updated_at = now() where ama_os.enrolments.source = 'hub';
  elsif src = 'Hub trial bookings' then
    insert into ama_os.trial_bookings (id, booked_at, booked_by, event_id, contact_id, parent, mobile9, child, school, data)
    select 'hub:' || coalesce(nullif(data->>'Event ID', ''), key), ama_os.safe_date(data->>'Booked at'), data->>'Booked by', data->>'Event ID', data->>'Contact ID', data->>'Parent',
           ama_os.mob9(data->>'Mobile'), data->>'Child', data->>'School', data
    from (select distinct on ('hub:' || coalesce(nullif(data->>'Event ID', ''), key)) key, data from ama_os.mirror where source = src order by 'hub:' || coalesce(nullif(data->>'Event ID', ''), key), synced_at desc) m
    on conflict (id) do update set booked_at = excluded.booked_at, booked_by = excluded.booked_by, event_id = excluded.event_id, contact_id = excluded.contact_id, parent = excluded.parent,
      mobile9 = excluded.mobile9, child = excluded.child, school = excluded.school, data = excluded.data, updated_at = now() where ama_os.trial_bookings.source = 'hub';
  else
    return 0;
  end if;
  get diagnostics n = row_count;
  return n;
end $$;

-- First import of everything already copied.
select ama_os.import_mirror(s) from unnest(array['Holds', 'Cancellations', 'Trial follow-up', 'New members', 'Enrolments', 'Hub trial bookings']) s;
revoke all on ama_os.holds, ama_os.cancellations, ama_os.trial_followups, ama_os.new_members, ama_os.enrolments, ama_os.trial_bookings from public;
