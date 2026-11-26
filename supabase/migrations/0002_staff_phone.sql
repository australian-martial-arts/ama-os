-- Staff sign in with their mobile (SMS code), the same login as the AMA Toolkit.
alter table ama_os.staff add column if not exists phone text unique
  check (phone is null or phone ~ '^\+61[0-9]{9}$');
comment on column ama_os.staff.phone is 'Mobile in +61 format; matches the shared Supabase phone login.';
update ama_os.staff set phone = '+61432917313' where email = 'mark.loughran@australianmartialarts.com.au' and phone is null;
