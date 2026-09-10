-- Admin security-definer RPCs + missing admin RLS policies.
-- Run on any new project after the main schema (setup_new_supabase_project.sql).
-- These let server functions act as the signed-in admin through RLS + RPCs,
-- removing the need for SUPABASE_SERVICE_ROLE_KEY at runtime.

-- 1) Missing admin RLS policies (idempotent)
do $do$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='profiles' and policyname='admins update profiles') then
    execute 'create policy "admins update profiles" on public.profiles for update to authenticated using (public.has_role(auth.uid(), ''admin''::public.app_role)) with check (public.has_role(auth.uid(), ''admin''::public.app_role))';
  end if;
end
$do$;

do $do$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='activity_events' and policyname='admins delete activity') then
    execute 'create policy "admins delete activity" on public.activity_events for delete to authenticated using (public.has_role(auth.uid(), ''admin''::public.app_role))';
  end if;
end
$do$;

-- 2) Admin RPCs (SECURITY DEFINER, run as postgres, guarded by admin role)
create or replace function public.admin_list_users()
returns table (id uuid, email varchar(255), created_at timestamptz, last_sign_in_at timestamptz, email_confirmed_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $body$
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Forbidden: admin only';
  end if;
  return query
    select u.id, u.email, u.created_at, u.last_sign_in_at, u.email_confirmed_at
    from auth.users u
    order by u.created_at desc
    limit 500;
end;
$body$;

create or replace function public.admin_delete_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $body$
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'Forbidden: admin only';
  end if;
  delete from auth.users where id = p_user_id;
end;
$body$;

revoke all on function public.admin_list_users() from public;
grant execute on function public.admin_list_users() to authenticated;
revoke all on function public.admin_delete_user(p_user_id uuid) from public;
grant execute on function public.admin_delete_user(p_user_id uuid) to authenticated;