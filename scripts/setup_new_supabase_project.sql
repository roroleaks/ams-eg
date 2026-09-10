-- Combined AMS schema for project switch to supabase://vizchdhrlpfklugfhpfy
-- Run this ONCE in the new project's SQL Editor. Pet names: pdfs bucket must be created manually later.

-- ==== 20260723192715_c05aec38-1da2-48d0-80fa-a800ce493065.sql ====

-- ==================== ROLES ====================
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE POLICY "users can read their own roles" ON public.user_roles
FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "admins can read all roles" ON public.user_roles
FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins can manage roles" ON public.user_roles
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Auto-grant admin role to the designated email on verified signup
CREATE OR REPLACE FUNCTION public.grant_admin_for_designated_email()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.email_confirmed_at IS NOT NULL
     AND lower(NEW.email) = 'raouf66@gmail.com' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created_grant_admin
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.grant_admin_for_designated_email();

CREATE TRIGGER on_auth_user_confirmed_grant_admin
AFTER UPDATE OF email_confirmed_at ON auth.users
FOR EACH ROW
WHEN (OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL)
EXECUTE FUNCTION public.grant_admin_for_designated_email();

-- ==================== DOCUMENTS ====================
CREATE TYPE public.doc_status AS ENUM ('pending', 'processing', 'indexed', 'failed');

CREATE TABLE public.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  filename text NOT NULL,
  storage_path text NOT NULL,
  version int NOT NULL DEFAULT 1,
  page_count int,
  chunk_count int NOT NULL DEFAULT 0,
  status public.doc_status NOT NULL DEFAULT 'pending',
  status_message text,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  indexed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.documents TO authenticated;
GRANT ALL ON public.documents TO service_role;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins manage documents" ON public.documents
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "authenticated can read documents" ON public.documents
FOR SELECT TO authenticated USING (true);

-- ==================== CHUNKS ====================
CREATE TABLE public.document_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  page int,
  chunk_index int NOT NULL,
  content text NOT NULL,
  embedding bytea,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX document_chunks_document_id_idx ON public.document_chunks(document_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_chunks TO authenticated;
GRANT ALL ON public.document_chunks TO service_role;
ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins manage chunks" ON public.document_chunks
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "authenticated read chunks" ON public.document_chunks
FOR SELECT TO authenticated USING (true);

-- ==================== INDEXING LOGS ====================
CREATE TABLE public.indexing_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  action text NOT NULL,
  status text NOT NULL,
  message text,
  duration_ms int,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX indexing_logs_created_at_idx ON public.indexing_logs(created_at DESC);

GRANT SELECT, INSERT ON public.indexing_logs TO authenticated;
GRANT ALL ON public.indexing_logs TO service_role;
ALTER TABLE public.indexing_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read logs" ON public.indexing_logs
FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins insert logs" ON public.indexing_logs
FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ==================== SEARCH ANALYTICS ====================
CREATE TABLE public.search_analytics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query text NOT NULL,
  result_count int NOT NULL DEFAULT 0,
  mode text,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX search_analytics_created_at_idx ON public.search_analytics(created_at DESC);

GRANT SELECT ON public.search_analytics TO authenticated;
GRANT INSERT ON public.search_analytics TO authenticated, anon;
GRANT ALL ON public.search_analytics TO service_role;
ALTER TABLE public.search_analytics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone can log searches" ON public.search_analytics
FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE POLICY "admins read analytics" ON public.search_analytics
FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ==================== USER PERMISSIONS ====================
CREATE TABLE public.user_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  can_search boolean NOT NULL DEFAULT true,
  can_summarize boolean NOT NULL DEFAULT true,
  can_download boolean NOT NULL DEFAULT true,
  notes text,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_permissions TO authenticated;
GRANT ALL ON public.user_permissions TO service_role;
ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read own permissions" ON public.user_permissions
FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "admins manage permissions" ON public.user_permissions
FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ==================== updated_at trigger ====================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER documents_updated_at
BEFORE UPDATE ON public.documents
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER user_permissions_updated_at
BEFORE UPDATE ON public.user_permissions
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ==================== STORAGE BUCKET (via storage.buckets is disallowed via SQL) ====================
-- Bucket is created via the storage tool. Policies below assume bucket name 'pdfs'.
CREATE POLICY "admins read pdf objects" ON storage.objects
FOR SELECT TO authenticated
USING (bucket_id = 'pdfs' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins insert pdf objects" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'pdfs' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins update pdf objects" ON storage.objects
FOR UPDATE TO authenticated
USING (bucket_id = 'pdfs' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins delete pdf objects" ON storage.objects
FOR DELETE TO authenticated
USING (bucket_id = 'pdfs' AND public.has_role(auth.uid(), 'admin'));

-- ==== 20260723192727_7f49054e-27bc-44c0-a234-7a6c2691c065.sql ====

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.grant_admin_for_designated_email() FROM PUBLIC, anon, authenticated;

-- ==== 20260725091539_d881be67-ac02-4cb2-bf30-69afc1855698.sql ====

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

-- ==== 20260804080115_8ae261e5-f2b7-4006-b064-70ee69c843cc.sql ====
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'owner';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'medical_editor';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'registered';

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text,
  email text,
  avatar_url text,
  provider_account_id text,
  provider text,
  search_count integer NOT NULL DEFAULT 0,
  report_count integer NOT NULL DEFAULT 0,
  last_login_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users read own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "users insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "users update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "admins read all profiles" ON public.profiles FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.search_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  query text NOT NULL,
  products text[] NOT NULL DEFAULT '{}',
  result_count integer NOT NULL DEFAULT 0,
  report_markdown text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX search_history_user_created_idx ON public.search_history (user_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.search_history TO authenticated;
GRANT ALL ON public.search_history TO service_role;
ALTER TABLE public.search_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own history" ON public.search_history FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "admins read history" ON public.search_history FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE public.favorites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_type text NOT NULL CHECK (item_type IN ('product','complaint','report')),
  item_key text NOT NULL,
  label text,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, item_type, item_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.favorites TO authenticated;
GRANT ALL ON public.favorites TO service_role;
ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own favorites" ON public.favorites FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "admins read favorites" ON public.favorites FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE public.guest_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  anon_id text NOT NULL,
  event text NOT NULL CHECK (event IN ('visit','search','report')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX guest_events_created_idx ON public.guest_events (created_at DESC);
GRANT INSERT ON public.guest_events TO anon, authenticated;
GRANT SELECT ON public.guest_events TO authenticated;
GRANT ALL ON public.guest_events TO service_role;
ALTER TABLE public.guest_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anyone records guest events" ON public.guest_events FOR INSERT TO anon, authenticated WITH CHECK (char_length(anon_id) BETWEEN 8 AND 64);
CREATE POLICY "admins read guest events" ON public.guest_events FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

GRANT INSERT ON public.search_analytics TO anon;
CREATE POLICY "guests log anonymous searches" ON public.search_analytics FOR INSERT TO anon WITH CHECK (user_id IS NULL);

-- ==== 20260818072949_6d9f4ad8-ca89-4158-beda-1c8d8d68acb9.sql ====
CREATE TABLE public.activity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  user_role text,
  organization text,
  session_id text,
  category text NOT NULL,
  event_type text NOT NULL,
  complaint_id text,
  product_id text,
  report_id text,
  reference_id text,
  result_count integer,
  immutable boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, DELETE ON public.activity_events TO authenticated;
GRANT INSERT ON public.activity_events TO anon;
GRANT ALL ON public.activity_events TO service_role;

ALTER TABLE public.activity_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read own activity" ON public.activity_events
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "admins read all activity" ON public.activity_events
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "users insert own activity" ON public.activity_events
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "guests insert anonymous activity" ON public.activity_events
  FOR INSERT TO anon WITH CHECK (user_id IS NULL);

CREATE POLICY "users delete own deletable activity" ON public.activity_events
  FOR DELETE TO authenticated USING (auth.uid() = user_id AND immutable = false);

CREATE INDEX activity_events_user_idx ON public.activity_events (user_id, created_at DESC);
CREATE INDEX activity_events_type_idx ON public.activity_events (event_type, created_at DESC);
CREATE INDEX activity_events_created_idx ON public.activity_events (created_at DESC);
CREATE INDEX activity_events_complaint_idx ON public.activity_events (complaint_id);
CREATE INDEX activity_events_product_idx ON public.activity_events (product_id);
CREATE INDEX activity_events_session_idx ON public.activity_events (session_id);

CREATE TABLE public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_by uuid REFERENCES auth.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins manage settings" ON public.app_settings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER app_settings_updated_at BEFORE UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.app_settings (key, value) VALUES ('activity_retention_days', '90'::jsonb);

CREATE OR REPLACE FUNCTION public.purge_activity_events()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  days integer;
  removed integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  SELECT COALESCE((value)::text::integer, 90) INTO days FROM public.app_settings WHERE key = 'activity_retention_days';
  DELETE FROM public.activity_events
   WHERE immutable = false AND created_at < now() - (days || ' days')::interval;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_activity_events() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purge_activity_events() TO authenticated;

-- ==== 20260818073010_a837638d-e808-404e-9cd4-92668adaa882.sql ====
DROP FUNCTION IF EXISTS public.purge_activity_events();

-- ==== 20260906075719_be5c7cf3-4587-4a9a-96d7-4b4c4b5d6f6f.sql ====
CREATE TABLE public.complaint_library (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  complaint text NOT NULL UNIQUE,
  products jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  literature jsonb NOT NULL DEFAULT '[]'::jsonb,
  report_markdown text,
  product_count integer NOT NULL DEFAULT 0,
  evidence_count integer NOT NULL DEFAULT 0,
  literature_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'ok',
  error text,
  built_by uuid REFERENCES auth.users(id),
  built_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.complaint_library TO anon;
GRANT SELECT ON public.complaint_library TO authenticated;
GRANT ALL ON public.complaint_library TO service_role;

ALTER TABLE public.complaint_library ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone reads the library" ON public.complaint_library
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "admins manage the library" ON public.complaint_library
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX complaint_library_complaint_idx ON public.complaint_library (complaint);

-- ==== 20260910131615_2c87909d-37ec-428a-94e6-d7d4486341ca.sql ====
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

-- 3. Keep profiles.role in sync with user_roles
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
CREATE TABLE IF NOT EXISTS public.user_sessions (
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

CREATE UNIQUE INDEX IF NOT EXISTS user_sessions_key_idx ON public.user_sessions (user_id, session_key);
CREATE INDEX IF NOT EXISTS user_sessions_user_idx ON public.user_sessions (user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS user_sessions_ended_idx ON public.user_sessions (ended_at);

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
CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action text NOT NULL,
  target_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_audit_logs_created_idx ON public.admin_audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_logs_admin_idx ON public.admin_audit_logs (admin_id);

GRANT ALL ON public.admin_audit_logs TO service_role;
GRANT SELECT, INSERT ON public.admin_audit_logs TO authenticated;
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read audit logs" ON public.admin_audit_logs
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins insert audit logs" ON public.admin_audit_logs
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 7. Guest mode removal
REVOKE INSERT ON public.guest_events FROM anon;
REVOKE INSERT ON public.search_analytics FROM anon;
REVOKE INSERT ON public.activity_events FROM anon;
REVOKE SELECT ON public.complaint_library FROM anon;

DROP POLICY IF EXISTS "anyone records guest events" ON public.guest_events;
DROP POLICY IF EXISTS "guests insert anonymous activity" ON public.activity_events;
DROP POLICY IF EXISTS "guests log anonymous searches" ON public.search_analytics;

DROP POLICY IF EXISTS "anyone reads the library" ON public.complaint_library;
DROP POLICY IF EXISTS "authenticated reads library" ON public.complaint_library;
CREATE POLICY "authenticated reads library" ON public.complaint_library
  FOR SELECT TO authenticated USING (true);

-- 8. Session cleanup helper
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

-- ==== 20260910131630_229bf53b-a7d8-46ec-a3e9-ae2be4e7a237.sql ====
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.touch_profile_sign_in() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_profile_role() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.protect_profile_role_status() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purge_old_sessions() FROM PUBLIC, anon;

