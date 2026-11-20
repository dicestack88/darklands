-- Dicestack Dimension migration 014: secure member roles and profile badges.
-- Members are "Member" by default; only elevated roles need a stored row.
-- The existing dicestack88 account is bootstrapped as the initial Owner.

create table if not exists public.dimension_member_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','moderator','supporter')),
  assigned_at timestamptz not null default now(),
  assigned_by uuid references auth.users(id) on delete set null
);

alter table public.dimension_member_roles enable row level security;
revoke all on public.dimension_member_roles from anon, authenticated;
grant select on public.dimension_member_roles to authenticated;

drop policy if exists "Signed-in members can view public role badges" on public.dimension_member_roles;
create policy "Signed-in members can view public role badges"
  on public.dimension_member_roles for select to authenticated
  using (true);

-- Preserve existing moderators, then make the known project owner explicit.
insert into public.dimension_member_roles(user_id, role)
select user_id, 'moderator' from public.darklands_moderators
on conflict (user_id) do nothing;

insert into public.dimension_member_roles(user_id, role)
select id, 'owner' from public.profiles where username = 'dicestack88'
on conflict (user_id) do update set role = 'owner', assigned_at = now();

create or replace function public.dimension_is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.dimension_member_roles
    where user_id = (select auth.uid()) and role = 'owner'
  );
$$;

revoke all on function public.dimension_is_owner() from public, anon;
grant execute on function public.dimension_is_owner() to authenticated;

-- Keep the existing moderation checks working, including legacy moderators.
create or replace function public.is_darklands_moderator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (select 1 from public.darklands_moderators where user_id = (select auth.uid()))
    or exists (
      select 1 from public.dimension_member_roles
      where user_id = (select auth.uid()) and role in ('owner','moderator')
    );
$$;

revoke all on function public.is_darklands_moderator() from public, anon;
grant execute on function public.is_darklands_moderator() to authenticated;

create or replace function public.dimension_search_role_members(p_query text default '')
returns table(user_id uuid, username text, display_name text, role text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_query text := left(trim(coalesce(p_query, '')), 60);
begin
  if not (select public.dimension_is_owner()) then
    raise exception 'Owner access required.' using errcode = '42501';
  end if;

  return query
  select p.id, p.username, p.display_name, coalesce(r.role, 'member')
  from public.profiles p
  left join public.dimension_member_roles r on r.user_id = p.id
  where v_query = ''
     or p.username ilike '%' || v_query || '%'
     or p.display_name ilike '%' || v_query || '%'
  order by case when r.role = 'owner' then 0 else 1 end, p.username
  limit 40;
end;
$$;

create or replace function public.dimension_set_member_role(p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select public.dimension_is_owner()) then
    raise exception 'Owner access required.' using errcode = '42501';
  end if;
  if p_user_id is null or p_role not in ('member','moderator','supporter') then
    raise exception 'Choose a valid member role.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.dimension_member_roles
    where user_id = p_user_id and role = 'owner'
  ) then
    raise exception 'The Owner role cannot be changed here.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'Member profile not found.' using errcode = 'P0002';
  end if;

  if p_role = 'member' then
    delete from public.dimension_member_roles where user_id = p_user_id;
    -- Remove any legacy moderator entry too, so demotion is effective.
    delete from public.darklands_moderators where user_id = p_user_id;
  else
    insert into public.dimension_member_roles(user_id, role, assigned_by)
    values(p_user_id, p_role, (select auth.uid()))
    on conflict (user_id) do update
      set role = excluded.role, assigned_at = now(), assigned_by = excluded.assigned_by;
    if p_role = 'moderator' then
      insert into public.darklands_moderators(user_id)
      values(p_user_id) on conflict (user_id) do nothing;
    else
      delete from public.darklands_moderators where user_id = p_user_id;
    end if;
  end if;
end;
$$;

revoke all on function public.dimension_search_role_members(text) from public, anon;
revoke all on function public.dimension_set_member_role(uuid, text) from public, anon;
grant execute on function public.dimension_search_role_members(text) to authenticated;
grant execute on function public.dimension_set_member_role(uuid, text) to authenticated;
