-- Let the project owner's SQL Editor login (postgres) start the AMA OS timers once pg_cron is allowed.
grant usage on schema ama_os to postgres;
grant execute on function ama_os.start_timers() to postgres;
