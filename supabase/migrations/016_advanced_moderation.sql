-- Dicestack Dimension migration 016: advanced moderation, restrictions, appeals and audit history.
-- Moderation decisions are performed only through checked SECURITY DEFINER RPCs.

create table if not exists public.dimension_moderation_actions (
  id uuid primary key default gen_random_uuid(),
  target_user_id uuid not null references auth.users(id) on delete cascade,
  moderator_id uuid references auth.users(id) on delete set null,
  action_type text not null check (action_type in ('warning','timeout','suspension','restriction_lifted','appeal_decision','clip_report_reviewed','message_report_reviewed','content_report_reviewed')),
  reason text not null default '',
  moderator_note text not null default '',
  context_type text,
  context_id uuid,
  created_at timestamptz not null default now(),
  constraint dimension_moderation_reason_length check (char_length(reason) <= 500),
  constraint dimension_moderation_note_length check (char_length(moderator_note) <= 500)
);
create index if not exists dimension_moderation_actions_target_idx
  on public.dimension_moderation_actions(target_user_id, created_at desc);
create index if not exists dimension_moderation_actions_created_idx
  on public.dimension_moderation_actions(created_at desc);
alter table public.dimension_moderation_actions enable row level security;
revoke all on public.dimension_moderation_actions from anon, authenticated;
grant select on public.dimension_moderation_actions to authenticated;
drop policy if exists "Members can view their own moderation history" on public.dimension_moderation_actions;
create policy "Members can view their own moderation history"
  on public.dimension_moderation_actions for select to authenticated
  using (target_user_id = (select auth.uid()) or (select public.is_darklands_moderator()));

create table if not exists public.dimension_account_restrictions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  action_id uuid not null references public.dimension_moderation_actions(id) on delete restrict,
  restriction_type text not null check (restriction_type in ('timeout','suspension')),
  reason text not null,
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  active boolean not null default true,
  lifted_at timestamptz,
  lifted_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint dimension_restriction_reason_length check (char_length(reason) <= 500),
  constraint dimension_restriction_expiry check (expires_at is null or expires_at > starts_at)
);
create index if not exists dimension_account_restrictions_active_idx
  on public.dimension_account_restrictions(user_id, active, expires_at);
alter table public.dimension_account_restrictions enable row level security;
revoke all on public.dimension_account_restrictions from anon, authenticated;
grant select on public.dimension_account_restrictions to authenticated;
drop policy if exists "Members can view their own restrictions" on public.dimension_account_restrictions;
create policy "Members can view their own restrictions"
  on public.dimension_account_restrictions for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_darklands_moderator()));

create table if not exists public.dimension_moderation_appeals (
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null unique references public.dimension_moderation_actions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  appeal_text text not null,
  status text not null default 'open' check (status in ('open','accepted','denied')),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  moderator_note text not null default '',
  constraint dimension_appeal_text_length check (char_length(trim(appeal_text)) between 10 and 2000),
  constraint dimension_appeal_note_length check (char_length(moderator_note) <= 500)
);
create index if not exists dimension_moderation_appeals_status_idx
  on public.dimension_moderation_appeals(status, submitted_at);
alter table public.dimension_moderation_appeals enable row level security;
revoke all on public.dimension_moderation_appeals from anon, authenticated;
grant select on public.dimension_moderation_appeals to authenticated;
drop policy if exists "Members can view their own appeals" on public.dimension_moderation_appeals;
create policy "Members can view their own appeals"
  on public.dimension_moderation_appeals for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_darklands_moderator()));

-- Reports for comments and member accounts. Clip and message reports retain their
-- existing tables and are extended below with the same review workflow.
create table if not exists public.dimension_content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  target_type text not null check (target_type in ('comment','account')),
  target_id uuid not null,
  target_user_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (reason in ('spam','harassment','inappropriate','privacy','impersonation','other')),
  details text not null default '',
  review_status text not null default 'open' check (review_status in ('open','reviewed','actioned','dismissed')),
  moderator_note text not null default '',
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint dimension_content_report_details_length check (char_length(details) <= 500),
  constraint dimension_content_report_note_length check (char_length(moderator_note) <= 500),
  constraint dimension_content_report_not_self check (reporter_id <> target_user_id),
  constraint dimension_content_report_unique unique (reporter_id,target_type,target_id)
);
create index if not exists dimension_content_reports_queue_idx
  on public.dimension_content_reports(review_status,created_at);
create index if not exists dimension_content_reports_target_idx
  on public.dimension_content_reports(target_user_id,created_at desc);
alter table public.dimension_content_reports enable row level security;
revoke all on public.dimension_content_reports from anon, authenticated;
grant select on public.dimension_content_reports to authenticated;
drop policy if exists "Moderators can review content reports" on public.dimension_content_reports;
create policy "Moderators can review content reports"
  on public.dimension_content_reports for select to authenticated
  using ((select public.is_darklands_moderator()));

alter table public.message_reports
  add column if not exists review_status text not null default 'open',
  add column if not exists moderator_note text not null default '',
  add column if not exists reviewed_by uuid references auth.users(id),
  add column if not exists reviewed_at timestamptz;
alter table public.message_reports
  drop constraint if exists message_reports_review_status_check;
alter table public.message_reports
  add constraint message_reports_review_status_check
  check (review_status in ('open','reviewed','actioned','dismissed'));
alter table public.message_reports
  drop constraint if exists message_reports_moderator_note_length;
alter table public.message_reports
  add constraint message_reports_moderator_note_length check (char_length(moderator_note) <= 500);
grant update (review_status,moderator_note) on public.message_reports to authenticated;
drop policy if exists "Moderators can review message reports" on public.message_reports;
create policy "Moderators can review message reports"
  on public.message_reports for update to authenticated
  using ((select public.is_darklands_moderator()))
  with check ((select public.is_darklands_moderator()));

create or replace function public.dimension_submit_content_report(
  p_target_type text,
  p_target_id uuid,
  p_reason text,
  p_details text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_target_user uuid;
  v_id uuid;
  v_details text := left(trim(coalesce(p_details,'')),500);
begin
  if v_user is null then raise exception 'Sign-in required.' using errcode='42501'; end if;
  if not coalesce(p_target_type in ('comment','account'),false) or p_target_id is null then
    raise exception 'Choose a valid report target.' using errcode='22023';
  end if;
  if not coalesce(p_reason in ('spam','harassment','inappropriate','privacy','impersonation','other'),false) then
    raise exception 'Choose a valid report reason.' using errcode='22023';
  end if;
  if p_target_type='account' then
    select id into v_target_user from public.profiles where id=p_target_id;
  else
    select cm.user_id into v_target_user
    from public.clip_comments cm
    join public.clips c on c.id=cm.clip_id
    where cm.id=p_target_id and c.status='approved';
  end if;
  if v_target_user is null then raise exception 'The reported content could not be found.' using errcode='P0002'; end if;
  if v_target_user=v_user then raise exception 'You cannot report your own account or comment.' using errcode='22023'; end if;
  insert into public.dimension_content_reports(reporter_id,target_type,target_id,target_user_id,reason,details)
  values(v_user,p_target_type,p_target_id,v_target_user,p_reason,v_details)
  on conflict (reporter_id,target_type,target_id) do nothing
  returning id into v_id;
  if v_id is null then raise exception 'You have already reported this item.' using errcode='23505'; end if;
  return v_id;
end;
$$;
revoke all on function public.dimension_submit_content_report(text,uuid,text,text) from public,anon;
grant execute on function public.dimension_submit_content_report(text,uuid,text,text) to authenticated;

create or replace function public.dimension_moderation_apply_action(
  p_target_user_id uuid,
  p_action text,
  p_reason text,
  p_duration_hours integer default null,
  p_context_type text default null,
  p_context_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_is_owner boolean := coalesce((select public.dimension_is_owner()),false);
  v_action_id uuid;
  v_target_role text;
  v_reason text := left(trim(coalesce(p_reason,'')),500);
  v_expires timestamptz;
begin
  if v_actor is null or not (select public.is_darklands_moderator()) then
    raise exception 'Moderator access required.' using errcode='42501';
  end if;
  if p_target_user_id is null or p_target_user_id=v_actor then
    raise exception 'Choose another member.' using errcode='22023';
  end if;
  if not exists(select 1 from public.profiles where id=p_target_user_id) then
    raise exception 'Member not found.' using errcode='P0002';
  end if;
  select role into v_target_role from public.dimension_member_roles where user_id=p_target_user_id;
  if v_target_role='owner' or (v_target_role='moderator' and not v_is_owner) then
    raise exception 'You do not have permission to moderate this member.' using errcode='42501';
  end if;
  if p_action not in ('warning','timeout','suspension','restriction_lifted') then
    raise exception 'Invalid moderation action.' using errcode='22023';
  end if;
  if p_action<>'restriction_lifted' and char_length(v_reason)<3 then
    raise exception 'Add a reason of at least 3 characters.' using errcode='22023';
  end if;
  if p_action='timeout' and (p_duration_hours is null or p_duration_hours<1 or p_duration_hours>720) then
    raise exception 'Timeouts must be between 1 hour and 30 days.' using errcode='22023';
  end if;
  if p_action='suspension' and p_duration_hours is not null and (p_duration_hours<1 or p_duration_hours>8760) then
    raise exception 'A suspension duration must be between 1 hour and 1 year, or left blank for an indefinite suspension.' using errcode='22023';
  end if;
  if p_action in ('warning','restriction_lifted') and p_duration_hours is not null then
    raise exception 'This action does not use a duration.' using errcode='22023';
  end if;
  if p_action='restriction_lifted' and not exists(
    select 1 from public.dimension_account_restrictions
    where user_id=p_target_user_id and active=true
      and (expires_at is null or expires_at>now())
  ) then
    raise exception 'This member has no active restriction to lift.' using errcode='22023';
  end if;
  if p_action='timeout' or p_action='suspension' then
    if p_duration_hours is not null then v_expires:=now()+make_interval(hours=>p_duration_hours); else v_expires:=null; end if;
  end if;

  insert into public.dimension_moderation_actions(target_user_id,moderator_id,action_type,reason,context_type,context_id)
  values(p_target_user_id,v_actor,p_action,v_reason,left(coalesce(p_context_type,''),30),p_context_id)
  returning id into v_action_id;

  if p_action='timeout' or p_action='suspension' then
    update public.dimension_account_restrictions
      set active=false,lifted_at=now(),lifted_by=v_actor
      where user_id=p_target_user_id and active=true;
    insert into public.dimension_account_restrictions(user_id,action_id,restriction_type,reason,expires_at)
    values(p_target_user_id,v_action_id,p_action,v_reason,v_expires);
  elsif p_action='restriction_lifted' then
    update public.dimension_account_restrictions
      set active=false,lifted_at=now(),lifted_by=v_actor
      where user_id=p_target_user_id and active=true;
  end if;
  return v_action_id;
end;
$$;
revoke all on function public.dimension_moderation_apply_action(uuid,text,text,integer,text,uuid) from public,anon;
grant execute on function public.dimension_moderation_apply_action(uuid,text,text,integer,text,uuid) to authenticated;

create or replace function public.dimension_submit_moderation_appeal(p_action_id uuid,p_appeal_text text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_appeal_id uuid;
begin
  if v_user is null then raise exception 'Sign-in required.' using errcode='42501'; end if;
  if char_length(trim(coalesce(p_appeal_text,'')))<10 or char_length(p_appeal_text)>2000 then
    raise exception 'Appeals must be between 10 and 2,000 characters.' using errcode='22023';
  end if;
  if not exists(
    select 1 from public.dimension_moderation_actions
    where id=p_action_id and target_user_id=v_user
      and action_type in ('warning','timeout','suspension')
      and created_at>now()-interval '30 days'
  ) then raise exception 'This action is not eligible for an appeal.' using errcode='42501'; end if;
  insert into public.dimension_moderation_appeals(action_id,user_id,appeal_text)
  values(p_action_id,v_user,trim(p_appeal_text))
  returning id into v_appeal_id;
  return v_appeal_id;
exception when unique_violation then
  raise exception 'You have already appealed this action.' using errcode='23505';
end;
$$;
revoke all on function public.dimension_submit_moderation_appeal(uuid,text) from public,anon;
grant execute on function public.dimension_submit_moderation_appeal(uuid,text) to authenticated;

create or replace function public.dimension_review_moderation_appeal(
  p_appeal_id uuid,
  p_decision text,
  p_moderator_note text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_appeal public.dimension_moderation_appeals%rowtype;
  v_action public.dimension_moderation_actions%rowtype;
begin
  if v_actor is null or not (select public.is_darklands_moderator()) then
    raise exception 'Moderator access required.' using errcode='42501';
  end if;
  if p_decision not in ('accepted','denied') then raise exception 'Choose accepted or denied.' using errcode='22023'; end if;
  select * into v_appeal from public.dimension_moderation_appeals where id=p_appeal_id for update;
  if not found or v_appeal.status<>'open' then raise exception 'Open appeal not found.' using errcode='P0002'; end if;
  select * into v_action from public.dimension_moderation_actions where id=v_appeal.action_id;
  if v_action.action_type in ('timeout','suspension') and coalesce((select role from public.dimension_member_roles where user_id=v_appeal.user_id),'member') in ('owner','moderator')
     and not (select public.dimension_is_owner()) then
    raise exception 'Owner access is required to review this appeal.' using errcode='42501';
  end if;
  update public.dimension_moderation_appeals
    set status=p_decision,reviewed_at=now(),reviewed_by=v_actor,moderator_note=left(trim(coalesce(p_moderator_note,'')),500)
    where id=p_appeal_id;
  if p_decision='accepted' then
    update public.dimension_account_restrictions
      set active=false,lifted_at=now(),lifted_by=v_actor
      where action_id=v_appeal.action_id and active=true;
  end if;
  insert into public.dimension_moderation_actions(target_user_id,moderator_id,action_type,reason,moderator_note,context_type,context_id)
  values(v_appeal.user_id,v_actor,'appeal_decision','Appeal '||p_decision,left(trim(coalesce(p_moderator_note,'')),500),'appeal',p_appeal_id);
end;
$$;
revoke all on function public.dimension_review_moderation_appeal(uuid,text,text) from public,anon;
grant execute on function public.dimension_review_moderation_appeal(uuid,text,text) to authenticated;

-- Every report decision is copied into the immutable-style action history.
create or replace function public.dimension_audit_clip_report_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_target uuid;
begin
  if new.review_status is distinct from old.review_status then
    select user_id into v_target from public.clips where id=new.clip_id;
    insert into public.dimension_moderation_actions(target_user_id,moderator_id,action_type,reason,moderator_note,context_type,context_id)
    values(v_target,(select auth.uid()),'clip_report_reviewed','Report marked '||new.review_status,left(new.moderator_note,500),'clip_report',new.id);
  end if;
  return new;
end;
$$;
revoke all on function public.dimension_audit_clip_report_review() from public,anon,authenticated;
drop trigger if exists dimension_audit_clip_report_review on public.clip_reports;
create trigger dimension_audit_clip_report_review after update on public.clip_reports
for each row execute function public.dimension_audit_clip_report_review();

create or replace function public.dimension_audit_message_report_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_target uuid;
begin
  if new.review_status is distinct from old.review_status then
    select case when c.user_one=new.reporter_id then c.user_two else c.user_one end
      into v_target from public.conversations c where c.id=new.conversation_id;
    insert into public.dimension_moderation_actions(target_user_id,moderator_id,action_type,reason,moderator_note,context_type,context_id)
    values(v_target,(select auth.uid()),'message_report_reviewed','Report marked '||new.review_status,left(new.moderator_note,500),'message_report',new.id);
  end if;
  return new;
end;
$$;
revoke all on function public.dimension_audit_message_report_review() from public,anon,authenticated;
drop trigger if exists dimension_audit_message_report_review on public.message_reports;
create trigger dimension_audit_message_report_review after update on public.message_reports
for each row execute function public.dimension_audit_message_report_review();

create or replace function public.dimension_audit_content_report_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.review_status is distinct from old.review_status then
    insert into public.dimension_moderation_actions(target_user_id,moderator_id,action_type,reason,moderator_note,context_type,context_id)
    values(new.target_user_id,(select auth.uid()),'content_report_reviewed','Report marked '||new.review_status,left(new.moderator_note,500),new.target_type,new.id);
  end if;
  return new;
end;
$$;
revoke all on function public.dimension_audit_content_report_review() from public,anon,authenticated;
drop trigger if exists dimension_audit_content_report_review on public.dimension_content_reports;
create trigger dimension_audit_content_report_review after update on public.dimension_content_reports
for each row execute function public.dimension_audit_content_report_review();

create or replace function public.dimension_set_message_report_review_metadata()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.review_status is distinct from old.review_status then
    if new.review_status='open' then new.reviewed_by:=null;new.reviewed_at:=null;
    else new.reviewed_by:=(select auth.uid());new.reviewed_at:=now();end if;
  else new.reviewed_by:=old.reviewed_by;new.reviewed_at:=old.reviewed_at;
  end if;
  return new;
end;
$$;
revoke all on function public.dimension_set_message_report_review_metadata() from public,anon,authenticated;
drop trigger if exists dimension_message_report_review_metadata on public.message_reports;
create trigger dimension_message_report_review_metadata before update on public.message_reports
for each row execute function public.dimension_set_message_report_review_metadata();

-- Restrict new user-generated activity at the database boundary. Existing content
-- remains readable, and moderators are never blocked by member restrictions.
create or replace function public.dimension_enforce_active_restriction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_kind text;
  v_reason text;
  v_expires timestamptz;
begin
  if tg_table_name='clips' then v_user:=new.user_id;
  elsif tg_table_name='clip_comments' then v_user:=new.user_id;
  elsif tg_table_name='messages' then v_user:=new.sender_id;
  else return new;
  end if;
  if v_user is null then return new; end if;
  select restriction_type,reason,expires_at into v_kind,v_reason,v_expires
  from public.dimension_account_restrictions
  where user_id=v_user and active=true and (expires_at is null or expires_at>now())
  order by created_at desc limit 1;
  if v_kind is not null then
    raise exception 'Your account has an active % restriction. Reason: %.% ',
      v_kind,v_reason,case when v_expires is null then ' No expiry is currently set.' else ' It expires at '||v_expires::text||'.' end
      using errcode='42501';
  end if;
  return new;
end;
$$;
revoke all on function public.dimension_enforce_active_restriction() from public,anon,authenticated;
drop trigger if exists dimension_restrict_clip_uploads on public.clips;
create trigger dimension_restrict_clip_uploads before insert on public.clips
for each row execute function public.dimension_enforce_active_restriction();
drop trigger if exists dimension_restrict_comments on public.clip_comments;
create trigger dimension_restrict_comments before insert on public.clip_comments
for each row execute function public.dimension_enforce_active_restriction();
drop trigger if exists dimension_restrict_messages on public.messages;
create trigger dimension_restrict_messages before insert on public.messages
for each row execute function public.dimension_enforce_active_restriction();

-- Indexes keep moderator queues responsive as reports accumulate.
create index if not exists clip_reports_review_queue_idx on public.clip_reports(review_status,created_at);
create index if not exists message_reports_review_queue_idx on public.message_reports(review_status,created_at);
