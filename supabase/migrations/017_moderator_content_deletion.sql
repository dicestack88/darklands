-- Moderator deletion controls for comments and specifically reported messages.
-- Apply after migration 016_advanced_moderation.sql.

alter table public.dimension_moderation_actions
  drop constraint if exists dimension_moderation_actions_action_type_check;
alter table public.dimension_moderation_actions
  add constraint dimension_moderation_actions_action_type_check
  check (action_type in (
    'warning','timeout','suspension','restriction_lifted','appeal_decision',
    'clip_report_reviewed','message_report_reviewed','content_report_reviewed',
    'comment_deleted','message_deleted'
  ));

create or replace function public.dimension_moderator_delete_comment(
  p_comment_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_target uuid;
begin
  if v_actor is null or not (select public.is_darklands_moderator()) then
    raise exception 'Moderator access required.' using errcode='42501';
  end if;
  if p_comment_id is null or char_length(trim(coalesce(p_reason,''))) < 3 then
    raise exception 'A comment and a reason of at least 3 characters are required.' using errcode='22023';
  end if;
  select user_id into v_target from public.clip_comments where id=p_comment_id for update;
  if v_target is null then raise exception 'Comment not found.' using errcode='P0002'; end if;
  insert into public.dimension_moderation_actions
    (target_user_id,moderator_id,action_type,reason,context_type,context_id)
  values(v_target,v_actor,'comment_deleted',left(trim(p_reason),500),'comment',p_comment_id);
  -- Replies and reactions follow the existing foreign-key cascade.
  delete from public.clip_comments where id=p_comment_id;
end;
$$;
revoke all on function public.dimension_moderator_delete_comment(uuid,text) from public,anon;
grant execute on function public.dimension_moderator_delete_comment(uuid,text) to authenticated;

create or replace function public.dimension_moderator_delete_reported_message(
  p_report_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_message uuid;
  v_target uuid;
begin
  if v_actor is null or not (select public.is_darklands_moderator()) then
    raise exception 'Moderator access required.' using errcode='42501';
  end if;
  if p_report_id is null or char_length(trim(coalesce(p_reason,''))) < 3 then
    raise exception 'A report and a reason of at least 3 characters are required.' using errcode='22023';
  end if;
  -- Moderators may only remove the exact message attached to an open report.
  select mr.message_id,m.sender_id into v_message,v_target
  from public.message_reports mr
  join public.messages m on m.id=mr.message_id and m.conversation_id=mr.conversation_id
  where mr.id=p_report_id and mr.review_status='open'
  for update of mr,m;
  if v_message is null then
    raise exception 'The reported message is unavailable or its report is no longer open.' using errcode='P0002';
  end if;
  insert into public.dimension_moderation_actions
    (target_user_id,moderator_id,action_type,reason,context_type,context_id)
  values(v_target,v_actor,'message_deleted',left(trim(p_reason),500),'message_report',p_report_id);
  delete from public.messages where id=v_message;
  update public.message_reports
    set review_status='actioned',moderator_note=left(trim(p_reason),500)
    where id=p_report_id;
end;
$$;
revoke all on function public.dimension_moderator_delete_reported_message(uuid,text) from public,anon;
grant execute on function public.dimension_moderator_delete_reported_message(uuid,text) to authenticated;
