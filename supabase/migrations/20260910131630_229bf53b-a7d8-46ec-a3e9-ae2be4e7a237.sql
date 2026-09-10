REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.touch_profile_sign_in() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_profile_role() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.protect_profile_role_status() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purge_old_sessions() FROM PUBLIC, anon;