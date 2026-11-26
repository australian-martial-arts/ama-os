-- Timer calls now get an instant answer (the work runs in the background), so a short timeout is enough
-- and the database's shared web-call queue (also used by the Toolkit) is never held up.
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
    timeout_milliseconds := 10000);
end $$;
