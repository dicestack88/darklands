-- Dicestack Dimension migration 018: beta feedback and feature suggestions.
create table if not exists public.dimension_feature_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null default 'feature' check (category in ('feature','improvement','bug','other')),
  title text not null check (char_length(title) between 4 and 100),
  description text not null check (char_length(description) between 10 and 1500),
  status text not null default 'new' check (status in ('new','reviewing','planned','completed','declined')),
  moderator_note text not null default '',
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dimension_feature_request_note_length check (char_length(moderator_note) <= 500)
);
create index if not exists dimension_feature_requests_created_idx
  on public.dimension_feature_requests(created_at desc);
create index if not exists dimension_feature_requests_status_idx
  on public.dimension_feature_requests(status, created_at desc);
alter table public.dimension_feature_requests enable row level security;
revoke all on public.dimension_feature_requests from anon, authenticated;
grant select on public.dimension_feature_requests to authenticated;
drop policy if exists "Dimension moderators can view feature requests" on public.dimension_feature_requests;
create policy "Dimension moderators can view feature requests"
  on public.dimension_feature_requests for select to authenticated
  using (public.is_darklands_moderator());

create or replace function public.dimension_submit_feature_request(
  p_category text,
  p_title text,
  p_description text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
  v_count integer;
begin
  if v_user is null then
    raise exception 'Please sign in to submit feedback.' using errcode='42501';
  end if;
  if not exists (
    select 1 from auth.users u
    where u.id = v_user and u.email_confirmed_at is not null
  ) then
    raise exception 'Please verify your email before submitting feedback.' using errcode='42501';
  end if;
  if p_category not in ('feature','improvement','bug','other') then
    raise exception 'Choose a valid feedback category.';
  end if;
  if char_length(trim(coalesce(p_title,''))) not between 4 and 100
     or char_length(trim(coalesce(p_description,''))) not between 10 and 1500 then
    raise exception 'Add a title (4–100 characters) and details (10–1,500 characters).';
  end if;
  select count(*) into v_count
  from public.dimension_feature_requests r
  where r.user_id=v_user and r.created_at > now() - interval '1 hour';
  if v_count >= 5 then
    raise exception 'You have reached the feedback limit. Please try again later.';
  end if;
  insert into public.dimension_feature_requests(user_id,category,title,description)
  values(v_user,p_category,trim(p_title),trim(p_description))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.dimension_review_feature_request(
  p_request_id uuid,
  p_status text,
  p_moderator_note text default ''
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_moderator uuid := auth.uid();
begin
  if v_moderator is null or not coalesce(public.is_darklands_moderator(),false) then
    raise exception 'Moderator access required.' using errcode='42501';
  end if;
  if p_status not in ('new','reviewing','planned','completed','declined') then
    raise exception 'Choose a valid feedback status.';
  end if;
  if char_length(coalesce(p_moderator_note,'')) > 500 then
    raise exception 'Moderator note must be 500 characters or fewer.';
  end if;
  update public.dimension_feature_requests
  set status=p_status,
      moderator_note=trim(coalesce(p_moderator_note,'')),
      reviewed_by=v_moderator,
      reviewed_at=now(),
      updated_at=now()
  where id=p_request_id;
  if not found then raise exception 'Feedback request not found.'; end if;
end;
$$;

revoke all on function public.dimension_submit_feature_request(text,text,text) from public, anon;
revoke all on function public.dimension_review_feature_request(uuid,text,text) from public, anon;
grant execute on function public.dimension_submit_feature_request(text,text,text) to authenticated;
grant execute on function public.dimension_review_feature_request(uuid,text,text) to authenticated;
