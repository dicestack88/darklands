-- Moderation member lookup: only moderators can search, and only public profile
-- fields are returned. No email addresses or private account metadata are exposed.
create or replace function public.dimension_moderation_search_members(p_query text)
returns table(
  user_id uuid,
  username text,
  display_name text,
  role text,
  has_active_restriction boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_query text := left(trim(coalesce(p_query,'')),60);
begin
  if (select auth.uid()) is null or not (select public.is_darklands_moderator()) then
    raise exception 'Moderator access required.' using errcode='42501';
  end if;
  if char_length(v_query)<2 then
    raise exception 'Enter at least 2 characters to search.' using errcode='22023';
  end if;
  return query
    select p.id,p.username,p.display_name,
      coalesce(r.role,'member'),
      exists(
        select 1 from public.dimension_account_restrictions ar
        where ar.user_id=p.id and ar.active=true
          and (ar.expires_at is null or ar.expires_at>now())
      )
    from public.profiles p
    left join public.dimension_member_roles r on r.user_id=p.id
    where p.username ilike '%'||v_query||'%'
       or p.display_name ilike '%'||v_query||'%'
    order by
      case when lower(p.username)=lower(v_query) then 0
           when lower(p.username) like lower(v_query)||'%' then 1 else 2 end,
      p.username
    limit 20;
end;
$$;
revoke all on function public.dimension_moderation_search_members(text) from public,anon;
grant execute on function public.dimension_moderation_search_members(text) to authenticated;
