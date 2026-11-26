-- 26 Nov 2026: short-lived cache for AMA OS reads from EFC and GHL (so busy screens don't re-ask every few seconds).
create table if not exists ama_os.cache (
  key   text primary key,
  data  jsonb not null,
  at    timestamptz not null default now()
);
revoke all on ama_os.cache from public;
