-- Darklands: persistent likes and comments for approved clips.
-- Members can only act as themselves. Only approved clips can be liked/commented on.

create table if not exists public.clip_likes (
  clip_id uuid not null references public.clips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (clip_id, user_id)
);

create index if not exists clip_likes_user_idx
  on public.clip_likes(user_id, created_at desc);

alter table public.clip_likes enable row level security;
revoke all on table public.clip_likes from anon, authenticated;
grant select, insert, delete on table public.clip_likes to authenticated;

drop policy if exists "Members can view likes on approved clips" on public.clip_likes;
create policy "Members can view likes on approved clips"
  on public.clip_likes for select to authenticated
  using (
    exists (
      select 1 from public.clips c
      where c.id = clip_id and c.status = 'approved'
    )
  );

drop policy if exists "Members can like approved clips as themselves" on public.clip_likes;
create policy "Members can like approved clips as themselves"
  on public.clip_likes for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.clips c
      where c.id = clip_id and c.status = 'approved'
    )
  );

drop policy if exists "Members can remove their own likes" on public.clip_likes;
create policy "Members can remove their own likes"
  on public.clip_likes for delete to authenticated
  using (user_id = (select auth.uid()));

create table if not exists public.clip_comments (
  id uuid primary key default gen_random_uuid(),
  clip_id uuid not null references public.clips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  constraint clip_comments_body_length
    check (char_length(trim(body)) between 1 and 500)
);

create index if not exists clip_comments_clip_created_idx
  on public.clip_comments(clip_id, created_at asc);

alter table public.clip_comments enable row level security;
revoke all on table public.clip_comments from anon, authenticated;
grant select, insert on table public.clip_comments to authenticated;

drop policy if exists "Members can view comments on approved clips" on public.clip_comments;
create policy "Members can view comments on approved clips"
  on public.clip_comments for select to authenticated
  using (
    exists (
      select 1 from public.clips c
      where c.id = clip_id and c.status = 'approved'
    )
  );

drop policy if exists "Members can comment on approved clips as themselves" on public.clip_comments;
create policy "Members can comment on approved clips as themselves"
  on public.clip_comments for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and char_length(trim(body)) between 1 and 500
    and exists (
      select 1 from public.clips c
      where c.id = clip_id and c.status = 'approved'
    )
  );
