DROP POLICY IF EXISTS "authenticated reads library" ON public.complaint_library;
CREATE POLICY "authenticated reads completed library"
ON public.complaint_library
FOR SELECT
TO authenticated
USING (status = 'ok' OR public.has_role(auth.uid(), 'admin'));

ALTER FUNCTION public.purge_old_sessions() SECURITY INVOKER;
REVOKE ALL ON FUNCTION public.purge_old_sessions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purge_old_sessions() TO authenticated;