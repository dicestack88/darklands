-- Darklands: secure moderation foundation
-- Apply only after reviewing this migration. Registration remains disabled.
-- Moderator membership is provisioned manually by a trusted database admin.

create table if not exists public.darklands_moderators (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.darklands_moderators enable row level security;
revoke all on public.darklands_moderators from anon, authenticated;

-- SECURITY DEFINER is used only to read the private moderator allow-list.
create or replace function public.is_darklands_moderator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.darklands_moderators
    where user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_darklands_moderator() from public, anon;
grant execute on function public.is_darklands_moderator() to authenticated;

-- Moderators may inspect all clips. Ordinary members retain their existing
-- ability to see approved clips and their own submissions.
drop policy if exists "Moderators can view all clips" on public.clips;
create policy "Moderators can view all clips"
  on public.clips for select to authenticated
  using ((select public.is_darklands_moderator()));

-- Do NOT grant direct UPDATE(status). Status changes go through this checked RPC.
revoke update (status) on public.clips from anon, authenticated;
create or replace function public.moderate_clip(
  p_clip_id uuid,
  p_new_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
     or not (select public.is_darklands_moderator()) then
    raise exception 'Moderator access required.' using errcode = '42501';
  end if;

  if p_new_status not in ('approved', 'rejected', 'removed') then
    raise exception 'Invalid moderation status.' using errcode = '22023';
  end if;

  update public.clips
  set status = p_new_status,
      updated_at = now()
  where id = p_clip_id;

  if not found then
    raise exception 'Clip not found.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.moderate_clip(uuid, text) from public, anon;
grant execute on function public.moderate_clip(uuid, text) to authenticated;

-- Add moderation workflow fields to reports.
alter table public.clip_reports
  add column if not exists review_status text not null default 'open',
  add column if not exists moderator_note text not null default '',
  add column if not exists reviewed_by uuid references auth.users(id),
  add column if not exists reviewed_at timestamptz;

alter table public.clip_reports
  drop constraint if exists clip_reports_review_status_check;
alter table public.clip_reports
  add constraint clip_reports_review_status_check
  check (review_status in ('open', 'reviewed', 'actioned', 'dismissed'));

alter table public.clip_reports
  drop constraint if exists clip_reports_moderator_note_length;
alter table public.clip_reports
  add constraint clip_reports_moderator_note_length
  check (char_length(moderator_note) <= 500);

-- Members can still read only their own reports. Moderators can inspect all.
drop policy if exists "Moderators can view all reports" on public.clip_reports;
create policy "Moderators can view all reports"
  on public.clip_reports for select to authenticated
  using ((select public.is_darklands_moderator()));

-- Only moderator review fields are writable, and RLS restricts this to moderators.
grant update (review_status, moderator_note) on public.clip_reports to authenticated;
drop policy if exists "Moderators can review reports" on public.clip_reports;
create policy "Moderators can review reports"
  on public.clip_reports for update to authenticated
  using ((select public.is_darklands_moderator()))
  with check ((select public.is_darklands_moderator()));

create or replace function public.set_clip_report_review_metadata()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.review_status is distinct from old.review_status then
    if new.review_status = 'open' then
      new.reviewed_by := null;
      new.reviewed_at := null;
    else
      new.reviewed_by := (select auth.uid());
      new.reviewed_at := now();
    end if;
  else
    -- Prevent clients from forging reviewer identity or timestamp.
    new.reviewed_by := old.reviewed_by;
    new.reviewed_at := old.reviewed_at;
  end if;
  return new;
end;
$$;

drop trigger if exists clip_report_review_metadata on public.clip_reports;
create trigger clip_report_review_metadata
  before update on public.clip_reports
  for each row execute function public.set_clip_report_review_metadata();
