-- Dicestack Dimension migration 015: private creator analytics and clip view tracking.
create table if not exists public.clip_views (
  id bigint generated always as identity primary key,
  clip_id uuid not null references public.clips(id) on delete cascade,
  viewer_id uuid not null references auth.users(id) on delete cascade,
  viewed_at timestamptz not null default now()
);
create index if not exists clip_views_clip_viewed_idx on public.clip_views(clip_id, viewed_at desc);
create index if not exists clip_views_viewer_clip_idx on public.clip_views(viewer_id, clip_id, viewed_at desc);
alter table public.clip_views enable row level security;
revoke all on public.clip_views from anon, authenticated;

create or replace function public.dimension_record_clip_view(p_clip_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_owner uuid;
begin
  if v_user is null then raise exception 'Sign-in required.' using errcode = '42501'; end if;
  select user_id into v_owner from public.clips where id = p_clip_id and status = 'approved';
  if v_owner is null then return false; end if;
  if v_owner = v_user then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':' || p_clip_id::text, 0));
  if exists (
    select 1 from public.clip_views
    where clip_id = p_clip_id and viewer_id = v_user
      and viewed_at > now() - interval '30 minutes'
  ) then return false; end if;
  insert into public.clip_views(clip_id, viewer_id) values(p_clip_id, v_user);
  return true;
end;
$$;
revoke all on function public.dimension_record_clip_view(uuid) from public, anon;
grant execute on function public.dimension_record_clip_view(uuid) to authenticated;

create or replace function public.dimension_get_creator_analytics(p_days integer default 30, p_user_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_target uuid;
  v_is_owner boolean := coalesce((select public.dimension_is_owner()), false);
  v_cutoff timestamptz;
  v_result jsonb;
begin
  if v_user is null then raise exception 'Sign-in required.' using errcode = '42501'; end if;
  if p_days not in (7,30,90,365,0) then raise exception 'Invalid date range.' using errcode = '22023'; end if;
  v_target := coalesce(p_user_id, v_user);
  if v_target <> v_user and not v_is_owner then
    raise exception 'You can only view your own analytics.' using errcode = '42501';
  end if;
  if v_target <> v_user and not exists(select 1 from public.profiles where id = v_target) then
    raise exception 'Creator not found.' using errcode = 'P0002';
  end if;
  v_cutoff := case when p_days = 0 then '-infinity'::timestamptz else now() - make_interval(days => p_days) end;

  if not exists(select 1 from public.clips where user_id = v_target) then
    return jsonb_build_object('totals',jsonb_build_object('views',0,'likes',0,'comments',0,'reposts',0,'saves',0,'clips',0),
      'daily','[]'::jsonb,'clips','[]'::jsonb);
  end if;

  select jsonb_build_object(
    'totals', jsonb_build_object(
      'views',(select count(*) from public.clip_views v join public.clips c on c.id=v.clip_id where c.user_id=v_target and c.status='approved' and v.viewed_at>=v_cutoff),
      'likes',(select count(*) from public.clip_likes l join public.clips c on c.id=l.clip_id where c.user_id=v_target and c.status='approved' and l.created_at>=v_cutoff),
      'comments',(select count(*) from public.clip_comments m join public.clips c on c.id=m.clip_id where c.user_id=v_target and c.status='approved' and m.created_at>=v_cutoff),
      'reposts',(select count(*) from public.clip_reposts r join public.clips c on c.id=r.clip_id where c.user_id=v_target and c.status='approved' and r.created_at>=v_cutoff),
      'saves',(select count(*) from public.clip_saves s join public.clips c on c.id=s.clip_id where c.user_id=v_target and c.status='approved' and s.created_at>=v_cutoff),
      'clips',(select count(*) from public.clips c where c.user_id=v_target and c.status='approved')
    ),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('date',d.day::date,'views',coalesce(x.view_count,0)) order by d.day)
      from generate_series(greatest(date_trunc('day',v_cutoff),date_trunc('day',now())-interval '29 days'),date_trunc('day',now()),interval '1 day') d(day)
      left join (
        select date_trunc('day',v.viewed_at) as view_day, count(*) as view_count
        from public.clip_views v join public.clips c on c.id=v.clip_id
        where c.user_id=v_target and c.status='approved' and v.viewed_at>=greatest(v_cutoff,now()-interval '30 days')
        group by 1
      ) x on x.view_day=d.day
    ),'[]'::jsonb),
    'clips', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',c.id,'caption',c.caption,'created_at',c.created_at,
        'views',(select count(*) from public.clip_views v where v.clip_id=c.id and v.viewed_at>=v_cutoff),
        'likes',(select count(*) from public.clip_likes l where l.clip_id=c.id and l.created_at>=v_cutoff),
        'comments',(select count(*) from public.clip_comments m where m.clip_id=c.id and m.created_at>=v_cutoff),
        'reposts',(select count(*) from public.clip_reposts r where r.clip_id=c.id and r.created_at>=v_cutoff),
        'saves',(select count(*) from public.clip_saves s where s.clip_id=c.id and s.created_at>=v_cutoff)
      ) order by c.created_at desc)
      from public.clips c where c.user_id=v_target and c.status='approved'
    ),'[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.dimension_get_creator_analytics(integer,uuid) from public, anon;
grant execute on function public.dimension_get_creator_analytics(integer,uuid) to authenticated;
