-- Darklands: allow trusted dashboard-created Auth users to be profiled manually.
-- Public registration remains disabled; this does not grant browser clients
-- permission to create profiles or accounts.

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

  -- Supabase Dashboard invitations may not include custom user metadata.
  -- Leave those trusted admin-created accounts without a profile so an
  -- administrator can create the profile explicitly in the SQL editor.
  if requested_username = '' and requested_display_name = '' then
    return new;
  end if;

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
