-- Dicestack Dimension migration 013: one-to-one voice calls inside accepted conversations.
-- Review before running in the Supabase SQL Editor. No service-role key is used by the browser.

create table if not exists public.voice_calls (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  caller_id uuid not null references auth.users(id) on delete cascade,
  callee_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'ringing'
    check (status in ('ringing','active','declined','missed','cancelled','ended')),
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz,
  expires_at timestamptz not null default (now() + interval '45 seconds'),
  constraint voice_calls_distinct_members check (caller_id <> callee_id)
);
create index if not exists voice_calls_callee_status_idx
  on public.voice_calls(callee_id,status,created_at desc);
create index if not exists voice_calls_caller_status_idx
  on public.voice_calls(caller_id,status,created_at desc);
create index if not exists voice_calls_conversation_idx
  on public.voice_calls(conversation_id,created_at desc);

alter table public.voice_calls enable row level security;
revoke all on public.voice_calls from anon, authenticated;
grant select on public.voice_calls to authenticated;
create policy "Members can view their own voice call records"
  on public.voice_calls for select to authenticated
  using ((select auth.uid()) in (caller_id,callee_id));

create table if not exists public.voice_call_signals (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references public.voice_calls(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  signal_type text not null check (signal_type in ('offer','answer','ice')),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  constraint voice_call_signals_distinct_members check (sender_id <> recipient_id),
  constraint voice_call_signals_payload_size check (pg_column_size(payload) <= 20000)
);
create index if not exists voice_call_signals_recipient_idx
  on public.voice_call_signals(recipient_id,created_at);
create index if not exists voice_call_signals_call_idx
  on public.voice_call_signals(call_id,created_at);
alter table public.voice_call_signals enable row level security;
revoke all on public.voice_call_signals from anon, authenticated;
grant select on public.voice_call_signals to authenticated;

create policy "Call recipients can read their own signalling data"
  on public.voice_call_signals for select to authenticated
  using (
    recipient_id=(select auth.uid())
    and exists (
      select 1 from public.voice_calls v
      join public.conversations c on c.id=v.conversation_id
      where v.id=call_id and v.status in ('ringing','active')
        and c.status='accepted'
        and (select auth.uid()) in (v.caller_id,v.callee_id)
        and not exists (
          select 1 from public.user_blocks b
          where (b.blocker_id=v.caller_id and b.blocked_id=v.callee_id)
             or (b.blocker_id=v.callee_id and b.blocked_id=v.caller_id)
        )
    )
  );
drop policy if exists "Call participants can send signalling data to the other participant" on public.voice_call_signals;

create or replace function public.dimension_start_voice_call(p_conversation uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_other uuid;
  v_call uuid;
begin
  if v_user is null then raise exception 'Sign in to start a call.'; end if;
  if p_conversation is null then raise exception 'Choose a conversation first.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 2));

  select case when c.user_one=v_user then c.user_two else c.user_one end
    into v_other
  from public.conversations c
  where c.id=p_conversation and v_user in (c.user_one,c.user_two)
    and c.status='accepted';
  if v_other is null then raise exception 'Calls are only available in accepted conversations.'; end if;
  -- Lock the pair in a stable order so simultaneous calls cannot race each other.
  perform pg_advisory_xact_lock(hashtextextended(least(v_user::text,v_other::text)||':'||greatest(v_user::text,v_other::text),2));

  if exists (
    select 1 from public.user_blocks b
    where (b.blocker_id=v_user and b.blocked_id=v_other)
       or (b.blocker_id=v_other and b.blocked_id=v_user)
  ) then raise exception 'Calling is unavailable for this member.'; end if;

  if not exists (
    select 1 from public.profiles p
    where p.id=v_other and p.presence_status in ('online','idle')
      and p.last_seen_at > now()-interval '90 seconds'
  ) then raise exception 'This member is unavailable for calls right now.'; end if;

  update public.voice_calls set status='missed',ended_at=now()
  where status='ringing' and expires_at<=now()
    and (caller_id in (v_user,v_other) or callee_id in (v_user,v_other));
  delete from public.voice_call_signals s
  using public.voice_calls v
  where s.call_id=v.id and v.status='missed' and v.ended_at>now()-interval '2 seconds';

  if exists (
    select 1 from public.voice_calls
    where status in ('ringing','active')
      and (caller_id in (v_user,v_other) or callee_id in (v_user,v_other))
  ) then raise exception 'One of you is already in a call.'; end if;

  if (select count(*) from public.voice_calls
      where caller_id=v_user and created_at>now()-interval '10 minutes') >= 5
  then raise exception 'You have started several calls recently. Please wait before trying again.'; end if;

  insert into public.voice_calls(conversation_id,caller_id,callee_id,status,expires_at)
  values(p_conversation,v_user,v_other,'ringing',now()+interval '45 seconds')
  returning id into v_call;
  return v_call;
end;
$$;

create or replace function public.dimension_answer_voice_call(p_call uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Sign in to answer this call.'; end if;
  update public.voice_calls v
  set status='active',answered_at=now()
  where v.id=p_call and v.callee_id=auth.uid()
    and v.status='ringing' and v.expires_at>now()
    and exists (
      select 1 from public.conversations c
      where c.id=v.conversation_id and c.status='accepted'
    )
    and not exists (
      select 1 from public.user_blocks b
      where (b.blocker_id=v.caller_id and b.blocked_id=v.callee_id)
         or (b.blocker_id=v.callee_id and b.blocked_id=v.caller_id)
    );
  if not found then raise exception 'This call is no longer available.'; end if;
end;
$$;

create or replace function public.dimension_decline_voice_call(p_call uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.voice_calls
  set status='declined',ended_at=now()
  where id=p_call and callee_id=auth.uid() and status='ringing';
  if not found then raise exception 'This call is no longer available.'; end if;
  delete from public.voice_call_signals where call_id=p_call;
end;
$$;

create or replace function public.dimension_end_voice_call(p_call uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.voice_calls
  set status=case when status='ringing' and caller_id=auth.uid() then 'cancelled'
                  when status='ringing' then 'declined' else 'ended' end,
      ended_at=now()
  where id=p_call and auth.uid() in (caller_id,callee_id)
    and status in ('ringing','active');
  if not found then raise exception 'This call has already ended.'; end if;
  delete from public.voice_call_signals where call_id=p_call;
end;
$$;

create or replace function public.dimension_mark_missed_voice_call(p_call uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.voice_calls
  set status='missed',ended_at=now()
  where id=p_call and callee_id=auth.uid()
    and status='ringing' and expires_at<=now();
  if found then delete from public.voice_call_signals where call_id=p_call; end if;
end;
$$;

create or replace function public.dimension_send_voice_signal(
  p_call uuid,p_recipient uuid,p_signal_type text,p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to continue this call.'; end if;
  if p_signal_type not in ('offer','answer','ice') or p_payload is null
     or pg_column_size(p_payload)>20000 then
    raise exception 'Invalid call connection data.';
  end if;
  insert into public.voice_call_signals(call_id,sender_id,recipient_id,signal_type,payload)
  select v.id,auth.uid(),p_recipient,p_signal_type,p_payload
  from public.voice_calls v
  join public.conversations c on c.id=v.conversation_id
  where v.id=p_call and v.status in ('ringing','active')
    and c.status='accepted'
    and ((auth.uid()=v.caller_id and p_recipient=v.callee_id)
      or (auth.uid()=v.callee_id and p_recipient=v.caller_id))
    and not exists (
      select 1 from public.user_blocks b
      where (b.blocker_id=v.caller_id and b.blocked_id=v.callee_id)
         or (b.blocker_id=v.callee_id and b.blocked_id=v.caller_id)
    )
  returning id into v_id;
  if v_id is null then raise exception 'The call is no longer available.'; end if;
  if (select count(*) from public.voice_call_signals where call_id=p_call and sender_id=auth.uid()) > 150 then
    raise exception 'Too many connection updates for this call.';
  end if;
  return v_id;
end;
$$;

create or replace function public.dimension_end_calls_on_block()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.voice_calls
  set status='ended',ended_at=now()
  where status in ('ringing','active')
    and ((caller_id=new.blocker_id and callee_id=new.blocked_id)
      or (caller_id=new.blocked_id and callee_id=new.blocker_id));
  delete from public.voice_call_signals s
  using public.voice_calls v
  where s.call_id=v.id
    and ((v.caller_id=new.blocker_id and v.callee_id=new.blocked_id)
      or (v.caller_id=new.blocked_id and v.callee_id=new.blocker_id));
  return new;
end;
$$;
revoke all on function public.dimension_end_calls_on_block() from public,anon,authenticated;
drop trigger if exists dimension_end_voice_calls_on_block on public.user_blocks;
create trigger dimension_end_voice_calls_on_block
  after insert on public.user_blocks
  for each row execute function public.dimension_end_calls_on_block();

revoke all on function public.dimension_start_voice_call(uuid) from public,anon;
revoke all on function public.dimension_answer_voice_call(uuid) from public,anon;
revoke all on function public.dimension_decline_voice_call(uuid) from public,anon;
revoke all on function public.dimension_end_voice_call(uuid) from public,anon;
revoke all on function public.dimension_mark_missed_voice_call(uuid) from public,anon;
revoke all on function public.dimension_send_voice_signal(uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.dimension_start_voice_call(uuid) to authenticated;
grant execute on function public.dimension_answer_voice_call(uuid) to authenticated;
grant execute on function public.dimension_decline_voice_call(uuid) to authenticated;
grant execute on function public.dimension_end_voice_call(uuid) to authenticated;
grant execute on function public.dimension_mark_missed_voice_call(uuid) to authenticated;
grant execute on function public.dimension_send_voice_signal(uuid,uuid,text,jsonb) to authenticated;

-- Deliver only the call rows and recipient-targeted signalling rows that RLS allows each member to read.
do $$
declare v_table text;
begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime') then
    foreach v_table in array array['voice_calls','voice_call_signals'] loop
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
alter table public.voice_calls replica identity full;
alter table public.voice_call_signals replica identity full;
