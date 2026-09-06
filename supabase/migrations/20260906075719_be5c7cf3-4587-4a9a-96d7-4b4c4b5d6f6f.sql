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