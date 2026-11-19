-- Darklands migration 010: private, in-app social notifications.
-- Notifications are created by trusted database triggers, never by browser inserts.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('clip_like','comment','comment_reply','comment_like','clip_repost','follow')),
  clip_id uuid references public.clips(id) on delete set null,
  comment_id uuid references public.clip_comments(id) on delete set null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint notifications_no_self_event check (recipient_id <> actor_id)
);

create index if not exists notifications_recipient_created_idx
  on public.notifications(recipient_id, created_at desc);
create index if not exists notifications_unread_idx
  on public.notifications(recipient_id, created_at desc)
  where read_at is null;

alter table public.notifications enable row level security;
revoke all on table public.notifications from anon, authenticated;
grant select on table public.notifications to authenticated;
grant update(read_at) on table public.notifications to authenticated;

drop policy if exists "Members can read their own notifications" on public.notifications;
create policy "Members can read their own notifications"
  on public.notifications for select to authenticated
  using (recipient_id = (select auth.uid()));

drop policy if exists "Members can mark their own notifications read" on public.notifications;
create policy "Members can mark their own notifications read"
  on public.notifications for update to authenticated
  using (recipient_id = (select auth.uid()))
  with check (recipient_id = (select auth.uid()));

create or replace function public.darklands_notify_social_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_recipient uuid;
  v_type text;
  v_clip uuid;
  v_comment uuid;
begin
  if tg_table_name = 'clip_likes' then
    v_actor := new.user_id;
    v_clip := new.clip_id;
    v_type := 'clip_like';
    select c.user_id into v_recipient from public.clips c
      where c.id = new.clip_id and c.status = 'approved';
  elsif tg_table_name = 'clip_comments' then
    v_actor := new.user_id;
    v_clip := new.clip_id;
    v_comment := new.id;
    if new.parent_comment_id is not null then
      v_type := 'comment_reply';
      select cm.user_id into v_recipient from public.clip_comments cm
        where cm.id = new.parent_comment_id;
    else
      v_type := 'comment';
      select c.user_id into v_recipient from public.clips c
        where c.id = new.clip_id and c.status = 'approved';
    end if;
  elsif tg_table_name = 'clip_comment_likes' then
    v_actor := new.user_id;
    v_comment := new.comment_id;
    v_type := 'comment_like';
    select cm.user_id, cm.clip_id into v_recipient, v_clip
      from public.clip_comments cm where cm.id = new.comment_id;
  elsif tg_table_name = 'clip_reposts' then
    v_actor := new.user_id;
    v_clip := new.clip_id;
    v_type := 'clip_repost';
    select c.user_id into v_recipient from public.clips c
      where c.id = new.clip_id and c.status = 'approved';
  elsif tg_table_name = 'user_follows' then
    v_actor := new.follower_id;
    v_recipient := new.following_id;
    v_type := 'follow';
  else
    return new;
  end if;

  if v_recipient is not null and v_actor is not null and v_recipient <> v_actor then
    insert into public.notifications(recipient_id, actor_id, type, clip_id, comment_id)
    values (v_recipient, v_actor, v_type, v_clip, v_comment);
  end if;
  return new;
end;
$$;

revoke all on function public.darklands_notify_social_event() from public, anon, authenticated;

drop trigger if exists darklands_notify_clip_like on public.clip_likes;
create trigger darklands_notify_clip_like after insert on public.clip_likes
for each row execute function public.darklands_notify_social_event();

drop trigger if exists darklands_notify_comment on public.clip_comments;
create trigger darklands_notify_comment after insert on public.clip_comments
for each row execute function public.darklands_notify_social_event();

drop trigger if exists darklands_notify_comment_like on public.clip_comment_likes;
create trigger darklands_notify_comment_like after insert on public.clip_comment_likes
for each row execute function public.darklands_notify_social_event();

drop trigger if exists darklands_notify_repost on public.clip_reposts;
create trigger darklands_notify_repost after insert on public.clip_reposts
for each row execute function public.darklands_notify_social_event();

drop trigger if exists darklands_notify_follow on public.user_follows;
create trigger darklands_notify_follow after insert on public.user_follows
for each row execute function public.darklands_notify_social_event();
