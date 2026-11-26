-- 26 Nov 2026 (Mark): give Tate full access to AMA OS (preview on). He signs in with his Toolkit login.
update ama_os.staff set role = 'full', preview = true, active = true, updated_at = now()
where lower(name) like 'tate%';
