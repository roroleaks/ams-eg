-- ====================================================================
-- Private application: profiles extension, user_sessions,
-- admin_audit_logs, guest-mode removal, triggers
-- ====================================================================

-- 1. Extend profiles table
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS role public.app_role NOT NULL DEFAULT 'user',
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','suspended','deleted')),
  ADD COLUMN IF NOT EXISTS last_sign_in_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_active_at timestamptz;

-- 2. Auto-create profile for every new auth user (idempotent)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name, avatar_url, provider, provider_account_id)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', NEW.raw_user_meta_data->>'picture'),
    COALESCE(NEW.raw_app_meta_data->>'provider', 'email'),
    COALESCE(NEW.raw_user_meta_data->>'sub', NEW.raw_user_meta_data->>'provider_id')
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    last_sign_in_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_create_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_create_profile
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Update last_sign_in_at on auth user sign-in
CREATE OR REPLACE FUNCTION public.touch_profile_sign_in()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
     SET last_sign_in_at = now()
   WHERE id = NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_signed_in ON auth.users;
CREATE TRIGGER on_auth_user_signed_in
AFTER UPDATE OF last_sign_in_at ON auth.users
FOR EACH ROW
WHEN (OLD.last_sign_in_at IS DISTINCT FROM NEW.last_sign_in_at)
EXECUTE FUNCTION public.touch_profile_sign_in();

-- 3. Keep profiles.role in sync with user_roles (the single source of truth)
CREATE OR REPLACE FUNCTION public.sync_profile_role()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE r public.app_role;
BEGIN
  SELECT role INTO r FROM public.user_roles WHERE user_id = COALESCE(NEW.user_id, OLD.user_id) ORDER BY created_at LIMIT 1;
  IF r IS NULL THEN r := 'user'::public.app_role; END IF;
  UPDATE public.profiles SET role = r WHERE id = COALESCE(NEW.user_id, OLD.user_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS on_user_roles_sync_profile ON public.user_roles;
CREATE TRIGGER on_user_roles_sync_profile
AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.sync_profile_role();

-- Ensure existing profiles have role synced
UPDATE public.profiles p SET role = COALESCE((SELECT u.role FROM public.user_roles u WHERE u.user_id = p.id LIMIT 1), 'user'::public.app_role);

-- 4. Protect profile role/status from user modification
CREATE OR REPLACE FUNCTION public.protect_profile_role_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role AND NOT (
    auth.role() = 'service_role' OR public.has_role(auth.uid(), 'admin')
  ) THEN
    RAISE EXCEPTION 'Forbidden: role cannot be changed by the user';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    auth.role() = 'service_role' OR public.has_role(auth.uid(), 'admin')
  ) THEN
    RAISE EXCEPTION 'Forbidden: status cannot be changed by the user';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_profile_role_status ON public.profiles;
CREATE TRIGGER protect_profile_role_status
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.protect_profile_role_status();

-- 5. user_sessions table
CREATE TABLE public.user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_key text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  duration_seconds integer,
  device_type text,
  browser text,
  operating_system text,
  referrer text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX user_sessions_key_idx ON public.user_sessions (user_id, session_key);
CREATE INDEX user_sessions_user_idx ON public.user_sessions (user_id, started_at DESC);
CREATE INDEX user_sessions_ended_idx ON public.user_sessions (ended_at);

GRANT SELECT, INSERT, UPDATE ON public.user_sessions TO authenticated;
GRANT ALL ON public.user_sessions TO service_role;

ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read own sessions" ON public.user_sessions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "users insert own sessions" ON public.user_sessions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users update own sessions" ON public.user_sessions
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "admins read all sessions" ON public.user_sessions
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins update sessions" ON public.user_sessions
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- 6. admin_audit_logs table
CREATE TABLE public.admin_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action text NOT NULL,
  target_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_logs_created_idx ON public.admin_audit_logs (created_at DESC);
CREATE INDEX admin_audit_logs_admin_idx ON public.admin_audit_logs (admin_id);

GRANT ALL ON public.admin_audit_logs TO service_role;
GRANT SELECT ON public.admin_audit_logs TO authenticated;
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read audit logs" ON public.admin_audit_logs
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins insert audit logs" ON public.admin_audit_logs
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 7. Guest mode removal: revoke anon access to previously-public tables
REVOKE INSERT ON public.guest_events FROM anon;
REVOKE INSERT ON public.search_analytics FROM anon;
REVOKE INSERT ON public.activity_events FROM anon;
REVOKE SELECT ON public.complaint_library FROM anon;

DROP POLICY IF EXISTS "anyone records guest events" ON public.guest_events;
DROP POLICY IF EXISTS "guests insert anonymous activity" ON public.activity_events;
DROP POLICY IF EXISTS "guests log anonymous searches" ON public.search_analytics;

-- complaint_library: now authenticated-only (no anon)
DROP POLICY IF EXISTS "anyone reads the library" ON public.complaint_library;
CREATE POLICY "authenticated reads library" ON public.complaint_library
  FOR SELECT TO authenticated USING (true);

-- 8. Activity retention cleanup helper (default 90 days)
CREATE OR REPLACE FUNCTION public.purge_old_sessions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  removed integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  -- End sessions idle > 30 min that have no explicit ended_at
  UPDATE public.user_sessions
     SET ended_at = last_seen_at,
         duration_seconds = ROUND(EXTRACT(EPOCH FROM (last_seen_at - started_at)))
   WHERE ended_at IS NULL
     AND last_seen_at < now() - interval '30 minutes';
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_old_sessions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purge_old_sessions() TO authenticated;