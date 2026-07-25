
-- Drop overly broad SELECT policies on documents / chunks
DROP POLICY IF EXISTS "authenticated can read documents" ON public.documents;
DROP POLICY IF EXISTS "authenticated read chunks" ON public.document_chunks;

-- Fix search_analytics insert policy: authenticated only + user_id = auth.uid()
DROP POLICY IF EXISTS "anyone can log searches" ON public.search_analytics;
CREATE POLICY "authenticated users log own searches"
  ON public.search_analytics
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- has_role: switch to SECURITY INVOKER (own-row RLS on user_roles suffices)
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- Revoke execute of the admin-grant trigger fn from anon/authenticated/public
REVOKE ALL ON FUNCTION public.grant_admin_for_designated_email() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grant_admin_for_designated_email() FROM anon;
REVOKE ALL ON FUNCTION public.grant_admin_for_designated_email() FROM authenticated;
