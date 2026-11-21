-- Dicestack Dimension migration 019: per-conversation chat wallpapers.
-- Run this manually in the Supabase SQL editor after reviewing it.
create table if not exists public.conversation_wallpapers (
  conversation_id uuid primary key references public.conversations(id) on delete cascade,
  wallpaper_path text not null check (char_length(wallpaper_path) between 1 and 500),
  updated_by uuid not null references auth.users(id) on delete cascade,
  updated_at timestamptz not null default now()
);
alter table public.conversation_wallpapers enable row level security;
revoke all on public.conversation_wallpapers from anon, authenticated;
grant select, insert, update, delete on public.conversation_wallpapers to authenticated;

drop policy if exists "Chat members can view conversation wallpapers" on public.conversation_wallpapers;
create policy "Chat members can view conversation wallpapers" on public.conversation_wallpapers
for select to authenticated using (exists (
  select 1 from public.conversations c where c.id=conversation_id and c.status='accepted'
  and (select auth.uid()) in (c.user_one,c.user_two)
));
drop policy if exists "Chat members can set conversation wallpapers" on public.conversation_wallpapers;
create policy "Chat members can set conversation wallpapers" on public.conversation_wallpapers
for insert to authenticated with check (
  updated_by=(select auth.uid()) and exists (
    select 1 from public.conversations c where c.id=conversation_id and c.status='accepted'
    and (select auth.uid()) in (c.user_one,c.user_two)
  )
);
drop policy if exists "Chat members can update conversation wallpapers" on public.conversation_wallpapers;
create policy "Chat members can update conversation wallpapers" on public.conversation_wallpapers
for update to authenticated using (exists (
  select 1 from public.conversations c where c.id=conversation_id and c.status='accepted'
  and (select auth.uid()) in (c.user_one,c.user_two)
)) with check (
  updated_by=(select auth.uid()) and exists (
    select 1 from public.conversations c where c.id=conversation_id and c.status='accepted'
    and (select auth.uid()) in (c.user_one,c.user_two)
  )
);
drop policy if exists "Chat members can reset conversation wallpapers" on public.conversation_wallpapers;
create policy "Chat members can reset conversation wallpapers" on public.conversation_wallpapers
for delete to authenticated using (exists (
  select 1 from public.conversations c where c.id=conversation_id and c.status='accepted'
  and (select auth.uid()) in (c.user_one,c.user_two)
));

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('dimension-message-wallpapers','dimension-message-wallpapers',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "Chat participants can view wallpaper files" on storage.objects;
create policy "Chat participants can view wallpaper files" on storage.objects for select to authenticated
using (bucket_id='dimension-message-wallpapers' and exists (
  select 1 from public.conversations c where c.id::text=(storage.foldername(name))[1]
  and c.status='accepted' and (select auth.uid()) in (c.user_one,c.user_two)
));
drop policy if exists "Chat participants can upload their own wallpaper files" on storage.objects;
create policy "Chat participants can upload their own wallpaper files" on storage.objects for insert to authenticated
with check (bucket_id='dimension-message-wallpapers'
  and (storage.foldername(name))[2]=(select auth.uid()::text)
  and exists (select 1 from public.conversations c where c.id::text=(storage.foldername(name))[1]
    and c.status='accepted' and (select auth.uid()) in (c.user_one,c.user_two)
));
drop policy if exists "Members can delete their own chat wallpaper files" on storage.objects;
create policy "Members can delete their own chat wallpaper files" on storage.objects for delete to authenticated
using (bucket_id='dimension-message-wallpapers'
  and (storage.foldername(name))[2]=(select auth.uid()::text)
  and exists (select 1 from public.conversations c where c.id::text=(storage.foldername(name))[1]
    and (select auth.uid()) in (c.user_one,c.user_two)
));

-- Keep both participants' open chat views synchronized when the shared theme changes.
do $$
begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname='supabase_realtime' and schemaname='public' and tablename='conversation_wallpapers'
     ) then
    alter publication supabase_realtime add table public.conversation_wallpapers;
  end if;
end $$;
