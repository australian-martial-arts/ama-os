#!/usr/bin/env bash
# Applies supabase/migrations/*.sql in order, once each, as the ama_os_app login.
# Tracks what has run in ama_os.schema_migrations. Each file runs in its own transaction.
set -euo pipefail
export PGSSLMODE=require
psql -v ON_ERROR_STOP=1 -q -c "create table if not exists ama_os.schema_migrations (name text primary key, applied_at timestamptz not null default now());"
for f in $(ls supabase/migrations/*.sql | sort); do
  name=$(basename "$f")
  done_already=$(psql -tA -c "select 1 from ama_os.schema_migrations where name = '$name'")
  if [ "$done_already" = "1" ]; then echo "skip  $name"; continue; fi
  echo "apply $name"
  psql -v ON_ERROR_STOP=1 -q --single-transaction -f "$f" -c "insert into ama_os.schema_migrations (name) values ('$name');"
done
