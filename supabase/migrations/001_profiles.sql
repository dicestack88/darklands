-- Darklands: initial profile schema
-- Review-only migration. Do not run until the Supabase project/account
-- arrangement and launch requirements have been reviewed.
--
-- Authentication credentials remain in Supabase Auth (auth.users).
-- This table contains public-facing profile fields only; never put email
-- addresses, passwords, verification codes, or private account data here.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  display_name text not null,
  bio text not null default '',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint profiles_username_format
    check (username = lower(username) and username ~ '^[a-z0-9_]{3,20}$'),
  constraint profiles_display_name_length
    check (char_length(trim(display_name)) between 1 and 32),
  constraint profiles_bio_length
    check (char_length(bio) <= 160)
);

-- Enforce case-insensitive username uniqueness.
create unique index if not exists profiles_username_lower_unique
  on public.profiles (lower(username));

-- Create a profile automatically when Supabase Auth creates an account.
-- The registration form must supply username and display_name in
-- auth.signUp({ options: { data: { username, display_name } } }).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_username text;
  requested_display_name text;
begin
  requested_username := lower(trim(coalesce(new.raw_user_meta_data ->> 'username', '')));
  requested_display_name := trim(coalesce(new.raw_user_meta_data ->> 'display_name', ''));

  if requested_username !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'Username must be 3–20 characters and contain only letters, numbers, or underscores.';
  end if;

  if char_length(requested_display_name) not between 1 and 32 then
    raise exception 'Display name must be between 1 and 32 characters.';
  end if;

  insert into public.profiles (id, username, display_name)
  values (new.id, requested_username, requested_display_name);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep identity fields immutable. Corrections, if ever needed, must be
-- handled through a deliberate, reviewed database maintenance change.
create or replace function public.prevent_profile_identity_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.username is distinct from old.username
     or new.display_name is distinct from old.display_name
     or new.created_at is distinct from old.created_at then
    raise exception 'Account identity fields cannot be changed.';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_identity_immutable on public.profiles;
create trigger profiles_identity_immutable
  before update on public.profiles
  for each row execute function public.prevent_profile_identity_change();

-- Enable RLS and grant only the operations needed by signed-in users.
alter table public.profiles enable row level security;

revoke all on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;
grant update (bio, avatar_url) on table public.profiles to authenticated;

drop policy if exists "Signed-in users can view profiles" on public.profiles;
create policy "Signed-in users can view profiles"
  on public.profiles
  for select
  to authenticated
  using (true);

drop policy if exists "Users can update their own profile details" on public.profiles;
create policy "Users can update their own profile details"
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- No direct INSERT or DELETE policy is intentional: profiles are created
-- only by the trusted Auth trigger and removed with their Auth user.
