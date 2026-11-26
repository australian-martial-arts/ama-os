-- AMA OS refresh timers inside the database (Sydney), so screens stay fresh without GitHub or the hub.
-- Each timer posts to amaos-dash with the refresh key (read here, never stored in the job text).
-- The anon key below is the public one already in site/config.js.
create or replace function ama_os.refresh_call(what text) returns bigint
language plpgsql security definer set search_path = ama_os, public as $$
declare k text;
begin
  select value into k from ama_os.connections where name = 'REFRESH_KEY';
  if k is null then return null; end if;
  return net.http_post(
    url := 'https://ptdrcxngaptcgswfbjhg.supabase.co/functions/v1/amaos-dash',
    body := jsonb_build_object('what', what, 'from', 'db'),
    headers := jsonb_build_object('content-type', 'application/json', 'x-amaos-refresh', k, 'x-region', 'ap-southeast-2',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB0ZHJjeG5nYXB0Y2dzd2ZiamhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1NDEzNTUsImV4cCI6MjEwNzExNzM1NX0.yVMEXjiRRsAd08jle7LhR9vw910qp_OF0h4hXfcSuPU', 'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB0ZHJjeG5nYXB0Y2dzd2ZiamhnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1NDEzNTUsImV4cCI6MjEwNzExNzM1NX0.yVMEXjiRRsAd08jle7LhR9vw910qp_OF0h4hXfcSuPU'),
    timeout_milliseconds := 150000);
end $$;
revoke all on function ama_os.refresh_call(text) from public;

-- Starts (or restarts) the timers. Needs the database login to be allowed to use pg_cron.
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
  return 'started';
end $$;
revoke all on function ama_os.start_timers() from public;

do $$ begin raise notice '%', ama_os.start_timers(); end $$;
