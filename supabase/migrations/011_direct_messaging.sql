-- Dicestack Dimension migration 011: private direct messaging.
-- Run only after reviewing this migration. No service-role key is used by the browser.

alter table public.profiles
  add column if not exists message_privacy text not null default 'requests'
    check (message_privacy in ('requests','mutuals','following')),
  add column if not exists presence_status text not null default 'online'
    check (presence_status in ('online','idle','dnd','offline')),
  add column if not exists last_seen_at timestamptz not null default now();

grant update (message_privacy, presence_status)
  on public.profiles to authenticated;

create table if not exists public.user_blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint user_blocks_no_self check (blocker_id <> blocked_id)
);
create index if not exists user_blocks_blocked_idx on public.user_blocks(blocked_id, blocker_id);
alter table public.user_blocks enable row level security;
revoke all on public.user_blocks from anon, authenticated;
grant select on public.user_blocks to authenticated;
create policy "Members can view blocks they created" on public.user_blocks
  for select to authenticated using (blocker_id = (select auth.uid()));

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_one uuid not null references auth.users(id) on delete cascade,
  user_two uuid not null references auth.users(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined','blocked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  constraint conversations_distinct_users check (user_one < user_two),
  constraint conversations_requester_is_member check (requested_by in (user_one,user_two)),
  constraint conversations_unique_pair unique(user_one,user_two)
);
create index if not exists conversations_user_one_activity_idx on public.conversations(user_one,last_message_at desc);
create index if not exists conversations_user_two_activity_idx on public.conversations(user_two,last_message_at desc);
alter table public.conversations enable row level security;
revoke all on public.conversations from anon, authenticated;
grant select on public.conversations to authenticated;
create policy "Members can view their conversations" on public.conversations
  for select to authenticated using (
    (select auth.uid()) in (user_one,user_two)
    and not exists (
      select 1 from public.user_blocks b
      where (b.blocker_id = (select auth.uid()) and b.blocked_id = case when user_one = (select auth.uid()) then user_two else user_one end)
         or (b.blocked_id = (select auth.uid()) and b.blocker_id = case when user_one = (select auth.uid()) then user_two else user_one end)
    )
  );

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 1000),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists messages_conversation_created_idx on public.messages(conversation_id,created_at);
alter table public.messages enable row level security;
revoke all on public.messages from anon, authenticated;
grant select, insert on public.messages to authenticated;
grant update(read_at) on public.messages to authenticated;
create policy "Conversation members can read messages" on public.messages
  for select to authenticated using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and (select auth.uid()) in (c.user_one,c.user_two)
        and c.status in ('pending','accepted')
        and not exists (
          select 1 from public.user_blocks b
          where (b.blocker_id = (select auth.uid()) and b.blocked_id = case when c.user_one = (select auth.uid()) then c.user_two else c.user_one end)
             or (b.blocked_id = (select auth.uid()) and b.blocker_id = case when c.user_one = (select auth.uid()) then c.user_two else c.user_one end)
        )
    )
  );
create policy "Members can send messages in accepted chats" on public.messages
  for insert to authenticated with check (
    sender_id = (select auth.uid())
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.status = 'accepted'
        and (select auth.uid()) in (c.user_one,c.user_two)
        and not exists (
          select 1 from public.user_blocks b
          where (b.blocker_id = (select auth.uid()) and b.blocked_id = case when c.user_one = (select auth.uid()) then c.user_two else c.user_one end)
             or (b.blocked_id = (select auth.uid()) and b.blocker_id = case when c.user_one = (select auth.uid()) then c.user_two else c.user_one end)
        )
    )
  );
create policy "Recipients can mark messages as read" on public.messages
  for update to authenticated using (
    sender_id <> (select auth.uid())
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and (select auth.uid()) in (c.user_one,c.user_two)
    )
  ) with check (
    sender_id <> (select auth.uid())
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id and (select auth.uid()) in (c.user_one,c.user_two)
    )
  );

create table if not exists public.message_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  message_id uuid references public.messages(id) on delete set null,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  reason text not null check (reason in ('spam','harassment','inappropriate','personal_information','other')),
  details text not null default '' check (char_length(details) <= 500),
  created_at timestamptz not null default now()
);
alter table public.message_reports enable row level security;
revoke all on public.message_reports from anon, authenticated;
grant insert, select on public.message_reports to authenticated;
create policy "Members can submit reports about their conversations" on public.message_reports
  for insert to authenticated with check (
    reporter_id = (select auth.uid())
    and exists (select 1 from public.conversations c where c.id = conversation_id and (select auth.uid()) in (c.user_one,c.user_two))
  );
create policy "Members can view their own reports" on public.message_reports
  for select to authenticated using (reporter_id = (select auth.uid()));

create or replace function public.dimension_send_message_request(p_recipient uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sender uuid := auth.uid();
  v_low uuid;
  v_high uuid;
  v_privacy text;
  v_status text;
  v_conversation uuid;
begin
  if v_sender is null then raise exception 'Sign in to send a message.'; end if;
  if p_recipient is null or p_recipient = v_sender then raise exception 'Choose another member.'; end if;
  if p_body is null or char_length(trim(p_body)) not between 1 and 1000 then raise exception 'Messages must be 1–1000 characters.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_sender::text, 0));
  if not exists (select 1 from public.profiles where id = p_recipient) then raise exception 'That member could not be found.'; end if;
  if exists (select 1 from public.user_blocks b where (b.blocker_id=v_sender and b.blocked_id=p_recipient) or (b.blocker_id=p_recipient and b.blocked_id=v_sender)) then
    raise exception 'Messaging is unavailable for this member.';
  end if;
  select message_privacy into v_privacy from public.profiles where id=p_recipient;
  if v_privacy = 'mutuals' and not (
    exists(select 1 from public.user_follows where follower_id=v_sender and following_id=p_recipient)
    and exists(select 1 from public.user_follows where follower_id=p_recipient and following_id=v_sender)
  ) then raise exception 'This member only accepts messages from mutual followers.'; end if;
  if v_privacy = 'following' and not exists (
    select 1 from public.user_follows where follower_id=v_sender and following_id=p_recipient
  ) then raise exception 'This member only accepts requests from people they follow.'; end if;
  if exists (select 1 from public.conversations where user_one=least(v_sender,p_recipient) and user_two=greatest(v_sender,p_recipient)) then
    raise exception 'A conversation or request with this member already exists.';
  end if;
  if (select count(*) from public.conversations where requested_by=v_sender and created_at > now()-interval '10 minutes') >= 5 then
    raise exception 'You have sent several requests recently. Please try again later.';
  end if;
  v_status := case when v_privacy='mutuals' then 'accepted' else 'pending' end;
  v_low := least(v_sender,p_recipient);
  v_high := greatest(v_sender,p_recipient);
  insert into public.conversations(user_one,user_two,requested_by,status)
  values(v_low,v_high,v_sender,v_status) returning id into v_conversation;
  insert into public.messages(conversation_id,sender_id,body)
  values(v_conversation,v_sender,trim(p_body));
  return v_conversation;
end;
$$;

create or replace function public.dimension_accept_message_request(p_conversation uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversations
  set status='accepted',updated_at=now()
  where id=p_conversation and status='pending'
    and (user_one=auth.uid() or user_two=auth.uid())
    and requested_by <> auth.uid()
    and not exists (
      select 1 from public.user_blocks b
      where (b.blocker_id=auth.uid() and b.blocked_id=case when user_one=auth.uid() then user_two else user_one end)
         or (b.blocked_id=auth.uid() and b.blocker_id=case when user_one=auth.uid() then user_two else user_one end)
    );
  if not found then raise exception 'This request is no longer available.'; end if;
end;
$$;

create or replace function public.dimension_decline_message_request(p_conversation uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversations set status='declined',updated_at=now()
  where id=p_conversation and status='pending'
    and (user_one=auth.uid() or user_two=auth.uid()) and requested_by <> auth.uid();
  if not found then raise exception 'This request is no longer available.'; end if;
end;
$$;

create or replace function public.dimension_block_member(p_member uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_member is null or p_member=auth.uid() then raise exception 'Choose another member.'; end if;
  insert into public.user_blocks(blocker_id,blocked_id) values(auth.uid(),p_member) on conflict do nothing;
  update public.conversations set status='blocked',updated_at=now()
  where user_one=least(auth.uid(),p_member) and user_two=greatest(auth.uid(),p_member);
end;
$$;

create or replace function public.dimension_unblock_member(p_member uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.user_blocks where blocker_id=auth.uid() and blocked_id=p_member;
  -- Removing a block also clears the blocked thread so a fresh request can be made.
  delete from public.conversations
  where status='blocked' and user_one=least(auth.uid(),p_member) and user_two=greatest(auth.uid(),p_member);
end;
$$;

create or replace function public.dimension_touch_presence(p_status text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then return; end if;
  if p_status is not null and p_status not in ('online','idle','dnd','offline') then raise exception 'Invalid presence status.'; end if;
  update public.profiles set
    presence_status=coalesce(p_status,presence_status),
    last_seen_at=now()
  where id=auth.uid();
end;
$$;

revoke all on function public.dimension_send_message_request(uuid,text) from public,anon;
revoke all on function public.dimension_accept_message_request(uuid) from public,anon;
revoke all on function public.dimension_decline_message_request(uuid) from public,anon;
revoke all on function public.dimension_block_member(uuid) from public,anon;
revoke all on function public.dimension_unblock_member(uuid) from public,anon;
revoke all on function public.dimension_touch_presence(text) from public,anon;
grant execute on function public.dimension_send_message_request(uuid,text) to authenticated;
grant execute on function public.dimension_accept_message_request(uuid) to authenticated;
grant execute on function public.dimension_decline_message_request(uuid) to authenticated;
grant execute on function public.dimension_block_member(uuid) to authenticated;
grant execute on function public.dimension_unblock_member(uuid) to authenticated;
grant execute on function public.dimension_touch_presence(text) to authenticated;


-- Keep inbox ordering current and create private in-app message notifications.
alter table public.notifications add column if not exists conversation_id uuid references public.conversations(id) on delete set null;
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (type in ('clip_like','comment','comment_reply','comment_like','clip_repost','follow','message','message_request'));

create or replace function public.dimension_after_message_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipient uuid;
  v_type text;
begin
  update public.conversations
  set last_message_at=new.created_at,updated_at=now()
  where id=new.conversation_id
  returning case when user_one=new.sender_id then user_two else user_one end
  into v_recipient;

  select case when c.status='pending' and c.requested_by=new.sender_id
    then 'message_request' else 'message' end
  into v_type
  from public.conversations c where c.id=new.conversation_id;

  if v_recipient is not null and v_recipient <> new.sender_id then
    insert into public.notifications(recipient_id,actor_id,type,conversation_id)
    values(v_recipient,new.sender_id,v_type,new.conversation_id);
  end if;
  return new;
end;
$$;

revoke all on function public.dimension_after_message_insert() from public,anon,authenticated;
drop trigger if exists dimension_message_inserted on public.messages;
create trigger dimension_message_inserted
  after insert on public.messages
  for each row execute function public.dimension_after_message_insert();

-- Moderators can review reports without exposing reports to other members.
drop policy if exists "Moderators can view message reports" on public.message_reports;
create policy "Moderators can view message reports"
  on public.message_reports for select to authenticated
  using ((select public.is_darklands_moderator()));


-- Enable live inbox, message and presence updates through Supabase Realtime.
do $$
declare
  v_table text;
begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime') then
    foreach v_table in array array['messages','conversations','profiles'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname='supabase_realtime' and schemaname='public' and tablename=v_table
      ) then
        execute format('alter publication supabase_realtime add table public.%I',v_table);
      end if;
    end loop;
  end if;
end;
$$;


-- Prevent message flooding even when a conversation has already been accepted.
create or replace function public.dimension_limit_message_rate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recent integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.sender_id::text, 1));
  select count(*) into v_recent
  from public.messages
  where sender_id=new.sender_id
    and created_at > now()-interval '1 minute';
  if v_recent >= 20 then
    raise exception 'You are sending messages too quickly. Please wait a moment.';
  end if;
  return new;
end;
$$;
revoke all on function public.dimension_limit_message_rate() from public,anon,authenticated;
drop trigger if exists dimension_message_rate_limit on public.messages;
create trigger dimension_message_rate_limit
  before insert on public.messages
  for each row execute function public.dimension_limit_message_rate();
