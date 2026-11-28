-- 28 Nov 2026 (Tate): his Google-email staff row had no mobile, so hub-routed screens couldn't
-- identify him ("Who is this?"). phone is unique and his mobile already sat on his hub-login row,
-- so MOVE the mobile onto the Google-email row (the one his sign-in matches). Idempotent.
do $$
begin
  if exists (select 1 from ama_os.staff where lower(email) = 'theggatonklenner@gmail.com' and coalesce(phone,'') = '') then
    update ama_os.staff set phone = null
      where phone = '+61483896150' and lower(email) <> 'theggatonklenner@gmail.com';
    update ama_os.staff set phone = '+61483896150'
      where lower(email) = 'theggatonklenner@gmail.com';
  end if;
end $$;
