-- 28 Nov 2026 (Tate): his Google-email staff row had no mobile, so hub-routed screens
-- couldn't identify him ("Who is this?"). Give that row his mobile; the hub matches on it.
update ama_os.staff set phone = '+61483896150'
where lower(email) = 'theggatonklenner@gmail.com' and coalesce(phone,'') = '';
