# ama-os

AMA OS: Admin Hub, Instructor Hub and Member Hub for Australian Martial Arts Academy.

| Folder | What it is |
|---|---|
| `apps-script/` | Untouched backup of the Google Apps Script hub (v457, 26 Nov 2026). Do not edit. |
| `site/` | The pages, served by Cloudflare Pages (ama-os.train-ama.com). |
| `supabase/migrations/` | Table changes, `ama_os` schema only. Applied automatically as the `ama_os_app` login. |
| `supabase/functions/amaos-*` | Edge functions (the hub's back end). Deployed automatically. |

Set-up rules (match the AMA Toolkit):
- Back end = Supabase edge functions, scheduled jobs = Supabase pg_cron, pages = Cloudflare Pages.
- AMA OS uses only the `ama_os` schema and the `ama_os_app` login. It never uses the service-role key, so it cannot read or change Toolkit tables.
- Sign-in uses the shared Supabase logins (one sign-in for the Toolkit and the hub).
- Secrets live in GitHub Actions secrets (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`) and Supabase function secrets (`AMA_OS_DB_URL`). Never in this repository.
