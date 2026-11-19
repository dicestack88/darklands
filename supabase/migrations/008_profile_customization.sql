-- Darklands: creator profile customization.
-- Public profile images are intentionally viewable to signed-in and logged-out visitors.
-- Each member can upload/delete only files in their own UUID folder.

alter table public.profiles
  add column if not exists banner_url text;

-- Display names are user-editable; account ID, username and creation time remain immutable.
create or replace function public.prevent_profile_identity_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.username is distinct from old.username
     or new.created_at is distinct from old.created_at then
    raise exception 'Account ID, username and creation time cannot be changed.';
  end if;

  if char_length(trim(new.display_name)) not between 1 and 32 then
    raise exception 'Display name must be between 1 and 32 characters.';
  end if;
  if char_length(new.bio) > 160 then
    raise exception 'Bio must be 160 characters or fewer.';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

grant update (display_name, bio, avatar_url, banner_url)
  on table public.profiles to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'darklands-profile-media',
  'darklands-profile-media',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = true,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Members can upload their own profile images" on storage.objects;
create policy "Members can upload their own profile images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'darklands-profile-media'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists "Members can delete their own profile images" on storage.objects;
create policy "Members can delete their own profile images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'darklands-profile-media'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );
