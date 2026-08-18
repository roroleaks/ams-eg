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