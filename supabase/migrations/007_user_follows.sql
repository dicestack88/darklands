-- Darklands: member-to-member follows.
-- A follow is always created by the signed-in follower; users cannot follow themselves.
create table if not exists public.user_follows (
  follower_id uuid not null references auth.users(id) on delete cascade,
  following_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  constraint user_follows_no_self_follow check (follower_id <> following_id)
);

create index if not exists user_follows_following_idx
  on public.user_follows (following_id, created_at desc);
create index if not exists user_follows_follower_idx
  on public.user_follows (follower_id, created_at desc);

alter table public.user_follows enable row level security;
revoke all on table public.user_follows from anon, authenticated;
grant select, insert, delete on table public.user_follows to authenticated;

drop policy if exists "Members can view follow relationships" on public.user_follows;
create policy "Members can view follow relationships"
  on public.user_follows for select to authenticated
  using (true);

drop policy if exists "Members can follow others as themselves" on public.user_follows;
create policy "Members can follow others as themselves"
  on public.user_follows for insert to authenticated
  with check (
    follower_id = (select auth.uid())
    and follower_id <> following_id
  );

drop policy if exists "Members can unfollow as themselves" on public.user_follows;
create policy "Members can unfollow as themselves"
  on public.user_follows for delete to authenticated
  using (follower_id = (select auth.uid()));
