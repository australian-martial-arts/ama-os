-- 28 Nov 2026 (Tate): Holiday-camp helper availability. Helpers get a personal link (token) or use a
-- shared link, search their own name, and tick the camp slots they can help at. Staff open slots,
-- see the roster and send the links. Schema ama_os only; read/written by the ama_os_app login (AMA OS
-- functions) via the amaos-camphelp edge function. Public never reaches these tables directly.

-- Openable helping slots (a camp day, or a session within a day).
create table if not exists ama_os.camp_helper_slots (
  slot_id    uuid primary key default gen_random_uuid(),
  slot_date  date not null,
  session    text not null default 'all',        -- 'all' | 'am' | 'pm' | a custom label
  location   text,
  label      text,                               -- optional display override
  cap        int  not null default 6,            -- helpers wanted for this slot
  is_open     boolean not null default true,     -- open for sign-up
  sort       int  not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists camp_helper_slots_open on ama_os.camp_helper_slots(is_open, slot_date);

-- The helpers. Each has a personal token (their private link). is_extra = shows in the shared-link name search.
create table if not exists ama_os.camp_helpers (
  helper_id  uuid primary key default gen_random_uuid(),
  full_name  text not null,
  token      text not null unique,
  mobile     text,
  email      text,
  active     boolean not null default true,
  is_extra   boolean not null default true,      -- appears in the public name picker
  created_at timestamptz not null default now(),
  invited_at timestamptz
);
create index if not exists camp_helpers_active on ama_os.camp_helpers(active);

-- Who put their hand up for which slot.
create table if not exists ama_os.camp_helper_signups (
  helper_id  uuid not null references ama_os.camp_helpers(helper_id) on delete cascade,
  slot_id    uuid not null references ama_os.camp_helper_slots(slot_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (helper_id, slot_id)
);
create index if not exists camp_helper_signups_slot on ama_os.camp_helper_signups(slot_id);

-- Locked down: only the ama_os_app login (the edge function) touches these.
revoke all on ama_os.camp_helper_slots, ama_os.camp_helpers, ama_os.camp_helper_signups from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on ama_os.camp_helper_slots, ama_os.camp_helpers, ama_os.camp_helper_signups from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on ama_os.camp_helper_slots, ama_os.camp_helpers, ama_os.camp_helper_signups from authenticated'; end if;
end $$;
