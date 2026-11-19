-- Darklands: private clip saves, public reposts, comment replies and comment hearts.
-- Run once after PR merge. All actions are scoped to the authenticated member.

alter table public.clip_comments
  add column if not exists parent_comment_id uuid;

create unique index if not exists clip_comments_id_clip_unique
  on public.clip_comments(id, clip_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'clip_comments_parent_same_clip_fk'
      and conrelid = 'public.clip_comments'::regclass
  ) then
    alter table public.clip_comments
      add constraint clip_comments_parent_same_clip_fk
      foreign key (parent_comment_id, clip_id)
      references public.clip_comments(id, clip_id)
      on delete cascade;
  end if;
end $$;

create index if not exists clip_comments_parent_idx
  on public.clip_comments(parent_comment_id, created_at asc)
  where parent_comment_id is not null;

create or replace function public.darklands_validate_comment_reply()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.parent_comment_id is not null then
    if new.parent_comment_id = new.id then
      raise exception 'A comment cannot reply to itself.';
    end if;
    if exists (
      select 1 from public.clip_comments parent
      where parent.id = new.parent_comment_id
        and parent.parent_comment_id is not null
    ) then
      raise exception 'Replies can only be one level deep.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists darklands_validate_comment_reply on public.clip_comments;
create trigger darklands_validate_comment_reply
before insert or update of parent_comment_id, clip_id
on public.clip_comments
for each row execute function public.darklands_validate_comment_reply();

create table if not exists public.clip_saves (
  clip_id uuid not null references public.clips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (clip_id, user_id)
);
create index if not exists clip_saves_user_created_idx
  on public.clip_saves(user_id, created_at desc);
alter table public.clip_saves enable row level security;
revoke all on table public.clip_saves from anon, authenticated;
grant select, insert, delete on table public.clip_saves to authenticated;

drop policy if exists "Members can view their own saved clips" on public.clip_saves;
create policy "Members can view their own saved clips"
  on public.clip_saves for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Members can save approved clips as themselves" on public.clip_saves;
create policy "Members can save approved clips as themselves"
  on public.clip_saves for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.clips c
      where c.id = clip_id and c.status = 'approved'
    )
  );

drop policy if exists "Members can unsave their own clips" on public.clip_saves;
create policy "Members can unsave their own clips"
  on public.clip_saves for delete to authenticated
  using (user_id = (select auth.uid()));

create table if not exists public.clip_reposts (
  clip_id uuid not null references public.clips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (clip_id, user_id)
);
create index if not exists clip_reposts_user_created_idx
  on public.clip_reposts(user_id, created_at desc);
alter table public.clip_reposts enable row level security;
revoke all on table public.clip_reposts from anon, authenticated;
grant select, insert, delete on table public.clip_reposts to authenticated;

drop policy if exists "Members can view reposts of approved clips" on public.clip_reposts;
create policy "Members can view reposts of approved clips"
  on public.clip_reposts for select to authenticated
  using (
    exists (
      select 1 from public.clips c
      where c.id = clip_id and c.status = 'approved'
    )
  );

drop policy if exists "Members can repost approved clips as themselves" on public.clip_reposts;
create policy "Members can repost approved clips as themselves"
  on public.clip_reposts for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.clips c
      where c.id = clip_id and c.status = 'approved'
    )
  );

drop policy if exists "Members can remove their own reposts" on public.clip_reposts;
create policy "Members can remove their own reposts"
  on public.clip_reposts for delete to authenticated
  using (user_id = (select auth.uid()));

create table if not exists public.clip_comment_likes (
  comment_id uuid not null references public.clip_comments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);
create index if not exists clip_comment_likes_user_idx
  on public.clip_comment_likes(user_id, created_at desc);
alter table public.clip_comment_likes enable row level security;
revoke all on table public.clip_comment_likes from anon, authenticated;
grant select, insert, delete on table public.clip_comment_likes to authenticated;

drop policy if exists "Members can view hearts on approved clip comments" on public.clip_comment_likes;
create policy "Members can view hearts on approved clip comments"
  on public.clip_comment_likes for select to authenticated
  using (
    exists (
      select 1 from public.clip_comments cm
      join public.clips c on c.id = cm.clip_id
      where cm.id = comment_id and c.status = 'approved'
    )
  );

drop policy if exists "Members can heart approved clip comments as themselves" on public.clip_comment_likes;
create policy "Members can heart approved clip comments as themselves"
  on public.clip_comment_likes for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.clip_comments cm
      join public.clips c on c.id = cm.clip_id
      where cm.id = comment_id and c.status = 'approved'
    )
  );

drop policy if exists "Members can remove their own comment hearts" on public.clip_comment_likes;
create policy "Members can remove their own comment hearts"
  on public.clip_comment_likes for delete to authenticated
  using (user_id = (select auth.uid()));
