
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
