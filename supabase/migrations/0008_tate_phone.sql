-- 26 Nov 2026 (Mark): Tate signs in with his mobile + PIN, which AMA OS matches by phone.
-- Give every Tate row full access, and copy his mobile from the hub staff copy onto his email row if it has none.
update ama_os.staff set role = 'full', preview = true, active = true, updated_at = now() where lower(name) like 'tate%';
update ama_os.staff s set phone = '+61' || right(regexp_replace(m.data->>'Mobile', '\D', '', 'g'), 9), updated_at = now()
from ama_os.mirror m
where m.source = 'Hub staff' and lower(m.data->>'Name') like 'tate%'
  and length(regexp_replace(coalesce(m.data->>'Mobile', ''), '\D', '', 'g')) >= 9
  and s.email = 'theggatonklenner@gmail.com' and coalesce(s.phone, '') = ''
  and not exists (select 1 from ama_os.staff x where x.email <> s.email and regexp_replace(coalesce(x.phone, ''), '\D', '', 'g') = '61' || right(regexp_replace(m.data->>'Mobile', '\D', '', 'g'), 9));
