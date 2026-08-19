CREATE TABLE IF NOT EXISTS public.client_admin_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  company_name TEXT,
  plan_type TEXT NOT NULL DEFAULT 'free',
  duration_days NUMERIC NOT NULL DEFAULT 30,
  status TEXT NOT NULL DEFAULT 'pending',
  invitation_token TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_admin_invitations_email
  ON public.client_admin_invitations (LOWER(email));

CREATE INDEX IF NOT EXISTS idx_client_admin_invitations_phone
  ON public.client_admin_invitations (phone);

CREATE INDEX IF NOT EXISTS idx_client_admin_invitations_status
  ON public.client_admin_invitations (status);

ALTER TABLE public.client_admin_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS client_admin_invitations_select ON public.client_admin_invitations;
CREATE POLICY client_admin_invitations_select
  ON public.client_admin_invitations
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS client_admin_invitations_insert ON public.client_admin_invitations;
CREATE POLICY client_admin_invitations_insert
  ON public.client_admin_invitations
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS client_admin_invitations_update ON public.client_admin_invitations;
CREATE POLICY client_admin_invitations_update
  ON public.client_admin_invitations
  FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);
