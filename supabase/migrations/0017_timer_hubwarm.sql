-- Keeps Approvals and My Day ready for the people testing them, so they open instantly (the hub itself is slow to answer).
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
  return 'started';
end $$;

do $$ begin raise notice '%', ama_os.start_timers(); end $$;
