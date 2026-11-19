-- Darklands: clips foundation
-- Review before running in Supabase SQL Editor. This creates a private video
-- bucket and database policies; it does not enable public registration.
--
-- Uploads remain private until a clip is explicitly approved by a moderator.
-- Do not change the bucket to public.

create table if not exists public.clips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  caption text not null default '',
  storage_path text not null unique,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint clips_caption_length check (char_length(caption) <= 300),
  constraint clips_status_check check (status in ('pending', 'approved', 'rejected', 'removed')),
  constraint clips_storage_path_owner check (storage_path like user_id::text || '/%')
);

create index if not exists clips_feed_idx
  on public.clips (status, created_at desc);
create index if not exists clips_user_created_idx
  on public.clips (user_id, created_at desc);

create or replace function public.prevent_clip_security_fields_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.user_id is distinct from old.user_id
     or new.storage_path is distinct from old.storage_path
     or new.created_at is distinct from old.created_at then
    raise exception 'Clip ownership, file path, status and creation time cannot be changed by a user.';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists clips_protect_fields on public.clips;
create trigger clips_protect_fields
  before update on public.clips
  for each row execute function public.prevent_clip_security_fields_change();

alter table public.clips enable row level security;
revoke all on table public.clips from anon, authenticated;
grant select on table public.clips to authenticated;
grant insert (user_id, caption, storage_path) on table public.clips to authenticated;
grant update (caption) on table public.clips to authenticated;
grant delete on table public.clips to authenticated;

drop policy if exists "Members can view approved clips and their own clips" on public.clips;
create policy "Members can view approved clips and their own clips"
  on public.clips for select to authenticated
  using (status = 'approved' or user_id = (select auth.uid()));

drop policy if exists "Members can submit their own clips for review" on public.clips;
create policy "Members can submit their own clips for review"
  on public.clips for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'pending'
  );

drop policy if exists "Members can edit captions on their pending clips" on public.clips;
create policy "Members can edit captions on their pending clips"
  on public.clips for update to authenticated
  using (user_id = (select auth.uid()) and status = 'pending')
  with check (user_id = (select auth.uid()) and status = 'pending');

drop policy if exists "Members can delete their own clips" on public.clips;
create policy "Members can delete their own clips"
  on public.clips for delete to authenticated
  using (user_id = (select auth.uid()));

create table if not exists public.clip_reports (
  id uuid primary key default gen_random_uuid(),
  clip_id uuid not null references public.clips (id) on delete cascade,
  reporter_id uuid not null references auth.users (id) on delete cascade,
  reason text not null,
  details text not null default '',
  created_at timestamptz not null default now(),

  constraint clip_reports_reason_check
    check (reason in ('spam', 'harassment', 'inappropriate', 'privacy', 'other')),
  constraint clip_reports_details_length check (char_length(details) <= 500),
  constraint clip_reports_one_per_member unique (clip_id, reporter_id)
);

create index if not exists clip_reports_clip_idx on public.clip_reports (clip_id);

alter table public.clip_reports enable row level security;
revoke all on table public.clip_reports from anon, authenticated;
grant select, insert on table public.clip_reports to authenticated;

drop policy if exists "Members can report approved clips" on public.clip_reports;
create policy "Members can report approved clips"
  on public.clip_reports for insert to authenticated
  with check (
    reporter_id = (select auth.uid())
    and exists (
      select 1 from public.clips c
      where c.id = clip_id
        and c.status = 'approved'
        and c.user_id <> (select auth.uid())
    )
  );

drop policy if exists "Members can view their own clip reports" on public.clip_reports;
create policy "Members can view their own clip reports"
  on public.clip_reports for select to authenticated
  using (reporter_id = (select auth.uid()));

-- Private video bucket: max 50 MB per file, only common browser-playable
-- video formats. Use paths in the form <auth-user-uuid>/<random-file-name>.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'darklands-clips',
  'darklands-clips',
  false,
  52428800,
  array['video/mp4', 'video/webm', 'video/quicktime']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Members can upload clips into their own folder" on storage.objects;
create policy "Members can upload clips into their own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'darklands-clips'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists "Members can read approved clips and their own uploads" on storage.objects;
create policy "Members can read approved clips and their own uploads"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'darklands-clips'
    and (
      (storage.foldername(name))[1] = (select auth.uid()::text)
      or exists (
        select 1 from public.clips c
        where c.storage_path = name
          and c.status = 'approved'
      )
    )
  );

drop policy if exists "Members can delete their own clip uploads" on storage.objects;
create policy "Members can delete their own clip uploads"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'darklands-clips'
    and owner_id = (select auth.uid()::text)
  );

-- Intentionally no user-facing UPDATE policy for storage objects and no
-- client policy for approving/rejecting clips or resolving reports.
-- A separate moderator workflow and test suite are required before launch.
