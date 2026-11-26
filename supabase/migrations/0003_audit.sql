-- Every important action in AMA OS is recorded here: who, what, when. Rows are never edited or deleted by the app.
create table if not exists ama_os.audit (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  actor       text not null,          -- staff name
  actor_login text,                   -- phone or email they signed in with
  role        text,
  action      text not null,          -- e.g. signin, trial.update, hold.approve
  entity      text,                   -- e.g. trial, member, hold
  entity_id   text,
  detail      jsonb not null default '{}'::jsonb
);
create index if not exists audit_at_idx on ama_os.audit (at desc);
create index if not exists audit_entity_idx on ama_os.audit (entity, entity_id);
comment on table ama_os.audit is 'Append-only record of AMA OS actions (who, what, when).';
