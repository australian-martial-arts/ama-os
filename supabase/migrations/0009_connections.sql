-- 26 Nov 2026 (Mark): AMA OS's own connections to EFC and GHL, so it reads from the source, not the hub.
-- Values are never sent back to any screen. Only the ama_os_app login (AMA OS functions) can read them.
create table if not exists ama_os.connections (
  name    text primary key,
  value   text not null,
  set_by  text not null,
  set_at  timestamptz not null default now()
);
revoke all on ama_os.connections from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on ama_os.connections from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on ama_os.connections from authenticated'; end if;
end $$;
