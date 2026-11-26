-- Passkeys (Face ID / fingerprint / device PIN) as the second step for owners and admins,
-- alongside authenticator apps. Public keys only: nothing secret is stored.
create table if not exists ama_os.passkeys (
  id            text primary key,          -- credential id (base64url)
  user_id       uuid not null,             -- Supabase login id
  public_key    text not null,             -- base64url COSE public key
  counter       bigint not null default 0,
  transports    text[] not null default '{}',
  rp_id         text not null,
  label         text,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);
create index if not exists passkeys_user_idx on ama_os.passkeys (user_id);

-- One pending challenge per person (expires after 5 minutes).
create table if not exists ama_os.webauthn_challenges (
  user_id     uuid primary key,
  challenge   text not null,
  kind        text not null check (kind in ('register','login')),
  expires_at  timestamptz not null
);

-- Confirmed second step: a random token (only its hash is stored), valid for 12 hours.
create table if not exists ama_os.stepup (
  token_hash  text primary key,
  user_id     uuid not null,
  method      text not null,
  expires_at  timestamptz not null
);
create index if not exists stepup_user_idx on ama_os.stepup (user_id);
