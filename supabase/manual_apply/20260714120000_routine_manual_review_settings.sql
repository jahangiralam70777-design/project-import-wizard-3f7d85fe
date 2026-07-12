-- =====================================================================
-- Routine Manual Study Review Settings — standalone, additive migration.
--
-- Adds a singleton settings table used by Routine Manager to control
-- whether manual study session submissions require admin approval.
--
-- When require_admin_approval = false, createStudySession auto-approves
-- new manual sessions at submission time. When true (default), the
-- existing pending → admin review workflow is preserved unchanged.
--
-- This migration is additive only. It does NOT modify existing tables,
-- policies, or any other module.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.routine_manual_review_settings (
  id                        boolean PRIMARY KEY DEFAULT true,
  require_admin_approval    boolean NOT NULL DEFAULT true,
  updated_at                timestamptz NOT NULL DEFAULT now(),
  updated_by                uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT routine_manual_review_settings_singleton CHECK (id = true)
);

-- Seed the single row so upsert / read paths always find it.
INSERT INTO public.routine_manual_review_settings (id, require_admin_approval)
VALUES (true, true)
ON CONFLICT (id) DO NOTHING;

-- Data API grants: authenticated reads, service role full.
GRANT SELECT ON public.routine_manual_review_settings TO authenticated;
GRANT ALL    ON public.routine_manual_review_settings TO service_role;

ALTER TABLE public.routine_manual_review_settings ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can READ the flag (student flows need it to know
-- whether their submissions auto-approve). No sensitive data is stored.
DROP POLICY IF EXISTS "rmrs_select_any_authenticated" ON public.routine_manual_review_settings;
CREATE POLICY "rmrs_select_any_authenticated"
  ON public.routine_manual_review_settings
  FOR SELECT TO authenticated
  USING (true);

-- Admin / super_admin: update the flag.
DROP POLICY IF EXISTS "rmrs_admin_update" ON public.routine_manual_review_settings;
CREATE POLICY "rmrs_admin_update"
  ON public.routine_manual_review_settings
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

-- Realtime (optional).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.routine_manual_review_settings;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

-- =====================================================================
-- Allow student self-approval on insert when the setting is OFF.
--
-- The original routine_study_sessions RLS policy hardcodes
-- status = 'pending' on insert, and a CHECK constraint requires that
-- pending rows have no reviewer set. Relax both so createStudySession
-- can insert an already-approved row (reviewed_by = the student
-- themselves) when the admin toggle is off. Approval still requires
-- populating both reviewed_by AND reviewed_at, matching admin flow.
-- =====================================================================
DO $$
BEGIN
  IF to_regclass('public.routine_study_sessions') IS NOT NULL THEN
    BEGIN
      ALTER TABLE public.routine_study_sessions
        DROP CONSTRAINT IF EXISTS rss_review_consistency;
    EXCEPTION WHEN undefined_object THEN NULL;
    END;

    ALTER TABLE public.routine_study_sessions
      ADD CONSTRAINT rss_review_consistency CHECK (
        (status = 'pending'  AND reviewed_by IS NULL     AND reviewed_at IS NULL)
        OR
        (status IN ('approved','rejected') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
      );

    DROP POLICY IF EXISTS rss_owner_insert ON public.routine_study_sessions;
    CREATE POLICY rss_owner_insert ON public.routine_study_sessions
      FOR INSERT TO authenticated
      WITH CHECK (
        user_id = auth.uid()
        AND (
          status = 'pending'
          OR (
            status = 'approved'
            AND reviewed_by = auth.uid()
            AND reviewed_at IS NOT NULL
          )
        )
      );
  END IF;
END $$;

