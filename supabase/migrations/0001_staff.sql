-- AMA OS: staff list and access levels (schema ama_os only; never touches the Toolkit's public schema).
create table if not exists ama_os.staff (
  email       text primary key check (email = lower(email)),
  name        text not null,
  role        text not null check (role in ('owner','full','marketing','admin','junior','instructor')),
  preview     boolean not null default false,   -- may see AMA OS while it is being built
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table ama_os.staff is 'AMA OS staff and access levels. Mirrors the Apps Script hub staff sheet until switch-over.';

-- First preview user, so the sign-in can be tested. The rest are added from the hub staff list.
insert into ama_os.staff (email, name, role, preview)
values ('mark.loughran@australianmartialarts.com.au', 'Mark Loughran', 'full', true)
on conflict (email) do nothing;
