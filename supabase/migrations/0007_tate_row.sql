-- 26 Nov 2026 (Mark): Tate is not on the hub staff sheet, so add him directly (full access, preview on).
-- Matches his Toolkit login by email. If he signs in by mobile instead, add his phone here.
insert into ama_os.staff (email, name, role, preview, active)
values ('theggatonklenner@gmail.com', 'Tate Heggatonklenner', 'full', true, true)
on conflict (email) do update set role = 'full', preview = true, active = true, updated_at = now();
