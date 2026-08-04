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