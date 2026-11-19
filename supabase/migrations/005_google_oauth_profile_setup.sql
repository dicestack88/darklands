-- Darklands: secure first-time profile completion for Google OAuth users.
-- Google establishes the Auth identity; this RPC creates the separate Darklands profile.
create or replace function public.complete_darklands_profile(
  p_username text,
  p_display_name text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_username text := lower(trim(coalesce(p_username, '')));
  requested_display_name text := trim(coalesce(p_display_name, ''));
begin
  if current_user_id is null then
    raise exception 'You must be signed in to create a profile.';
  end if;

  if requested_username !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'Username must be 3–20 characters using lowercase letters, numbers, or underscores.';
  end if;

  if char_length(requested_display_name) not between 1 and 32 then
    raise exception 'Display name must be between 1 and 32 characters.';
  end if;

  if exists (select 1 from public.profiles where id = current_user_id) then
    raise exception 'A Darklands profile already exists for this account.';
  end if;

  insert into public.profiles (id, username, display_name)
  values (current_user_id, requested_username, requested_display_name);
end;
$$;

revoke all on function public.complete_darklands_profile(text, text) from public, anon;
grant execute on function public.complete_darklands_profile(text, text) to authenticated;

comment on function public.complete_darklands_profile(text, text) is
  'Creates the signed-in user’s initial Darklands profile after Google OAuth. Identity fields remain immutable.';
