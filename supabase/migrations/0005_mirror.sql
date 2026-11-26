-- AMA OS: nightly read-only copy of the Apps Script hub, for side-by-side checks before switch-over.
-- Nothing in AMA OS writes back to the hub, EFC or GHL from this data.
alter table ama_os.staff add column if not exists hub_role text;
alter table ama_os.staff add column if not exists synced_at timestamptz;

create table if not exists ama_os.mirror (
  source     text not null,          -- hub sheet tab, e.g. 'EFC live', 'Holds'
  key        text not null,          -- row key within that tab
  data       jsonb not null,         -- the row, column name -> value (secrets never copied)
  synced_at  timestamptz not null default now(),
  primary key (source, key)
);
comment on table ama_os.mirror is 'Read-only nightly copy of the hub sheets. Replaced in full for each tab on every sync.';

create table if not exists ama_os.mirror_runs (
  id       bigserial primary key,
  source   text not null,
  rows     int not null,
  at       timestamptz not null default now(),
  note     text
);
