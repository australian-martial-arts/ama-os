-- 27 Nov 2026: an AMA OS background job could be paused mid-query and keep its database connection busy,
-- which made every screen wait. Clear any AMA OS session stuck for over a minute, now and every minute.
create or replace function ama_os.reap() returns int
language sql security definer set search_path = ama_os, public as $$
  select count(pg_terminate_backend(pid))::int from pg_stat_activity
  where usename = current_user and pid <> pg_backend_pid() and state <> 'idle'
    and backend_type = 'client backend' and now() - query_start > interval '60 seconds'
    and wait_event = 'ClientRead';
$$;

create or replace function ama_os.start_timers() returns text
language plpgsql security definer set search_path = ama_os, public as $$
declare j record;
begin
  if not has_schema_privilege('cron', 'usage') then return 'waiting: AMA OS login cannot use pg_cron yet'; end if;
  for j in select jobname from cron.job where jobname like 'amaos-%' loop perform cron.unschedule(j.jobname); end loop;
  perform cron.schedule('amaos-efc',    '* * * * *',      $c$select ama_os.refresh_call('efcnext')$c$);
  perform cron.schedule('amaos-trials', '*/5 * * * *',    $c$select ama_os.refresh_call('trials')$c$);
  perform cron.schedule('amaos-absent', '1-59/5 * * * *', $c$select ama_os.refresh_call('absent')$c$);
  perform cron.schedule('amaos-dash',   '3-59/5 * * * *', $c$select ama_os.refresh_call('dash')$c$);
  perform cron.schedule('amaos-hubwarm', '2-59/5 * * * *', $c$select ama_os.refresh_call('hubwarm')$c$);
  perform cron.schedule('amaos-reap',   '* * * * *',      $c$select ama_os.reap()$c$);
  return 'started';
end $$;

do $$ begin raise notice 'cleared %', ama_os.reap(); raise notice '%', ama_os.start_timers(); end $$;
