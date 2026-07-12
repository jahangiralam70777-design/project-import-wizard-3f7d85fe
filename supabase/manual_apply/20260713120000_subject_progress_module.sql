-- =====================================================================
-- Subject Progress Module — standalone, additive migration.
--
-- Apply manually against the project database. Creates ONLY the objects
-- required by the Subject Progress backend
-- (src/lib/subject-progress.functions.ts and
--  src/lib/admin-subject-progress.functions.ts).
--
-- External dependencies (read-only, NOT modified):
--   - public.subjects, public.chapters       (enumeration)
--   - public.mcqs, public.mcq_practice_progress (MCQ completion source)
--   - public.profiles                        (student identity)
--   - public.user_roles + public.has_role    (RLS admin checks)
--   - public.has_permission                  (RLS analytics permission)
--
-- This migration NEVER alters Routine / Quiz / Mock Test / Custom Exam /
-- Wrong Questions / Bookmarks / existing Analytics or Progress tables.
-- =====================================================================

-- ---------- Enum: manual track status ----------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'subject_progress_status') THEN
    CREATE TYPE public.subject_progress_status AS ENUM (
      'not_started',
      'in_progress',
      'completed'
    );
  END IF;
END $$;

-- ---------- Local updated_at trigger fn (idempotent) ----------
CREATE OR REPLACE FUNCTION public.subject_progress_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- =====================================================================
-- Table: subject_progress_chapter
-- One row per (student, chapter). Stores the three manually editable
-- tracks (class / slide / book). MCQ completion is derived at query
-- time from mcq_practice_progress and is intentionally NOT stored here,
-- which makes MCQ % structurally un-editable by students.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.subject_progress_chapter (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  chapter_id         uuid NOT NULL REFERENCES public.chapters(id) ON DELETE CASCADE,

  class_status       public.subject_progress_status NOT NULL DEFAULT 'not_started',
  slide_status       public.subject_progress_status NOT NULL DEFAULT 'not_started',
  book_status        public.subject_progress_status NOT NULL DEFAULT 'not_started',

  class_updated_at   timestamptz,
  slide_updated_at   timestamptz,
  book_updated_at    timestamptz,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz,
  deleted_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  CONSTRAINT subject_progress_chapter_unique UNIQUE (user_id, chapter_id)
);

-- Indexes tuned to backend queries (upsert onConflict + IN (...) lookups).
CREATE INDEX IF NOT EXISTS idx_spc_user          ON public.subject_progress_chapter (user_id);
CREATE INDEX IF NOT EXISTS idx_spc_chapter       ON public.subject_progress_chapter (chapter_id);
CREATE INDEX IF NOT EXISTS idx_spc_user_chapter  ON public.subject_progress_chapter (user_id, chapter_id);
CREATE INDEX IF NOT EXISTS idx_spc_updated_at    ON public.subject_progress_chapter (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_spc_class_status  ON public.subject_progress_chapter (class_status);
CREATE INDEX IF NOT EXISTS idx_spc_slide_status  ON public.subject_progress_chapter (slide_status);
CREATE INDEX IF NOT EXISTS idx_spc_book_status   ON public.subject_progress_chapter (book_status);

-- Data API grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subject_progress_chapter TO authenticated;
GRANT ALL ON public.subject_progress_chapter TO service_role;

-- updated_at trigger
DROP TRIGGER IF EXISTS trg_spc_touch_updated_at ON public.subject_progress_chapter;
CREATE TRIGGER trg_spc_touch_updated_at
BEFORE UPDATE ON public.subject_progress_chapter
FOR EACH ROW EXECUTE FUNCTION public.subject_progress_touch_updated_at();

ALTER TABLE public.subject_progress_chapter ENABLE ROW LEVEL SECURITY;

-- Student: read own rows
DROP POLICY IF EXISTS "spc_select_own" ON public.subject_progress_chapter;
CREATE POLICY "spc_select_own"
  ON public.subject_progress_chapter
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Student: insert own rows (upsert path)
DROP POLICY IF EXISTS "spc_insert_own" ON public.subject_progress_chapter;
CREATE POLICY "spc_insert_own"
  ON public.subject_progress_chapter
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Student: update own rows (the three manual tracks)
DROP POLICY IF EXISTS "spc_update_own" ON public.subject_progress_chapter;
CREATE POLICY "spc_update_own"
  ON public.subject_progress_chapter
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Admin / super_admin: full read for reports
DROP POLICY IF EXISTS "spc_admin_select_all" ON public.subject_progress_chapter;
CREATE POLICY "spc_admin_select_all"
  ON public.subject_progress_chapter
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

-- Admin / super_admin: maintenance updates (soft delete, corrections)
DROP POLICY IF EXISTS "spc_admin_update_all" ON public.subject_progress_chapter;
CREATE POLICY "spc_admin_update_all"
  ON public.subject_progress_chapter
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

-- =====================================================================
-- Table: subject_progress_activity_log
-- Append-only audit trail of student updates + admin views/reports.
-- Backend writes: user_id, action, entity_type, entity_id, metadata.
-- old_value / new_value / student_id are optional structured fields.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.subject_progress_activity_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  student_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action       text NOT NULL CHECK (char_length(action) BETWEEN 1 AND 100),
  entity_type  text NOT NULL CHECK (char_length(entity_type) BETWEEN 1 AND 100),
  entity_id    uuid,
  old_value    jsonb NOT NULL DEFAULT '{}'::jsonb,
  new_value    jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_spal_user       ON public.subject_progress_activity_log (user_id);
CREATE INDEX IF NOT EXISTS idx_spal_student    ON public.subject_progress_activity_log (student_id);
CREATE INDEX IF NOT EXISTS idx_spal_action     ON public.subject_progress_activity_log (action);
CREATE INDEX IF NOT EXISTS idx_spal_entity     ON public.subject_progress_activity_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_spal_created_at ON public.subject_progress_activity_log (created_at DESC);

GRANT SELECT, INSERT ON public.subject_progress_activity_log TO authenticated;
GRANT ALL ON public.subject_progress_activity_log TO service_role;

ALTER TABLE public.subject_progress_activity_log ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can insert their own audit row.
DROP POLICY IF EXISTS "spal_insert_self" ON public.subject_progress_activity_log;
CREATE POLICY "spal_insert_self"
  ON public.subject_progress_activity_log
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Students see only their own audit rows.
DROP POLICY IF EXISTS "spal_select_own" ON public.subject_progress_activity_log;
CREATE POLICY "spal_select_own"
  ON public.subject_progress_activity_log
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Admin / super_admin: full read for analytics / audit review.
DROP POLICY IF EXISTS "spal_admin_select_all" ON public.subject_progress_activity_log;
CREATE POLICY "spal_admin_select_all"
  ON public.subject_progress_activity_log
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

-- =====================================================================
-- Realtime (optional; consistent with other modules).
-- =====================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.subject_progress_chapter;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;
