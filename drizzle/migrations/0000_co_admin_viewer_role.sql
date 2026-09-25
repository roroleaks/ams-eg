ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'co_admin';

CREATE OR REPLACE FUNCTION public.can_view_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role::text IN ('admin','co_admin'))
$$;
REVOKE ALL ON FUNCTION public.can_view_admin(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.can_view_admin(uuid) TO authenticated;

CREATE POLICY "co-admins read activity" ON public.activity_events FOR SELECT TO authenticated USING (public.can_view_admin(auth.uid()));
CREATE POLICY "co-admins read audit" ON public.admin_audit_logs FOR SELECT TO authenticated USING (public.can_view_admin(auth.uid()));
CREATE POLICY "co-admins read settings" ON public.app_settings FOR SELECT TO authenticated USING (public.can_view_admin(auth.uid()));
CREATE POLICY "co-admins read library" ON public.complaint_library FOR SELECT TO authenticated USING (public.can_view_admin(auth.uid()));
CREATE POLICY "co-admins read chunks" ON public.document_chunks FOR SELECT TO authenticated USING (public.can_view_admin(auth.uid()));
CREATE POLICY "co-admins read documents" ON public.documents FOR SELECT TO authenticated USING (public.can_view_admin(auth.uid()));
CREATE POLICY "co-admins read favorites" ON public.favorites FOR SELECT TO authenticated USING (public.can_view_admin(auth.uid()));
CREATE POLICY "co-admins read guest events" ON public.guest_events FOR SELECT TO authenticated USING (public.can_view_admin(auth.uid()));
CREATE POLICY "co-admins read indexing logs" ON public.indexing_logs FOR SELECT TO authenticated USING (public.can_view_admin(auth.uid()));
CREATE POLICY "co-admins read profiles" ON public.profiles FOR SELECT TO authenticated USING (public.can_view_admin(auth.uid()));
CREATE POLICY "co-admins read analytics" ON public.search_analytics FOR SELECT TO authenticated USING (public.can_view_admin(auth.uid()));
CREATE POLICY "co-admins read history" ON public.search_history FOR SELECT TO authenticated USING (public.can_view_admin(auth.uid()));
CREATE POLICY "co-admins read permissions" ON public.user_permissions FOR SELECT TO authenticated USING (public.can_view_admin(auth.uid()));
CREATE POLICY "co-admins read roles" ON public.user_roles FOR SELECT TO authenticated USING (public.can_view_admin(auth.uid()));
CREATE POLICY "co-admins read sessions" ON public.user_sessions FOR SELECT TO authenticated USING (public.can_view_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE (id uuid, email varchar(255), created_at timestamptz, last_sign_in_at timestamptz, email_confirmed_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $body$
BEGIN
  IF NOT public.can_view_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden: admin only';
  END IF;
  RETURN QUERY SELECT u.id, u.email, u.created_at, u.last_sign_in_at, u.email_confirmed_at
    FROM auth.users u ORDER BY u.created_at DESC LIMIT 500;
END;
$body$;