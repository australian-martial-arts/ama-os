-- 26 Nov 2026: key for the scheduled refresh (GitHub Actions reads it from the database; never shown anywhere).
insert into ama_os.connections (name, value, set_by)
values ('REFRESH_KEY', md5(random()::text || clock_timestamp()::text) || md5(random()::text || clock_timestamp()::text), 'system')
on conflict (name) do nothing;
