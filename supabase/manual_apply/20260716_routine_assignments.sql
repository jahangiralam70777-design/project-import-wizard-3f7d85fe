-- =====================================================================
-- Routine Assignments — explicit student targeting.
-- Standalone migration. Do NOT modify prior routine migrations.
--
-- What this adds:
--   1. public.routines.assignment_mode          ('all_students' | 'selected_students')
--   2. public.routine_assignments                (routine_id, student_id, ...)
--   3. GRANT DELETE on public.routines to authenticated
--      (existing routine_management migration only granted SELECT/INSERT/UPDATE,
--       so adminDeleteRoutine could not actually delete — RLS admin policy
--       cannot bypass the missing table-level GRANT.)
--
-- Runtime contract:
--   - If routine.assignment_mode = 'all_students', every profile matching
--     the routine scope (level) sees the routine.
--   - If 'selected_students', only rows in routine_assignments with
--     status='active' see the routine.
--
-- Apply manually in Supabase SQL editor.
-- =====================================================================

-- --- 1. routines.assignment_mode ------------------------------------
ALTER TABLE public.routines
  ADD COLUMN IF NOT EXISTS assignment_mode text NOT NULL DEFAULT 'all_students';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'routines_assignment_mode_valid'
      AND conrelid = 'public.routines'::regclass
  ) THEN
    ALTER TABLE public.routines
      ADD CONSTRAINT routines_assignment_mode_valid
        CHECK (assignment_mode IN ('all_students','selected_students'));
  END IF;
END$$;

-- --- 2. routine_assignments -----------------------------------------
CREATE TABLE IF NOT EXISTS public.routine_assignments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  routine_id    uuid NOT NULL REFERENCES public.routines(id) ON DELETE CASCADE,
  student_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status        text NOT NULL DEFAULT 'active',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT routine_assignments_status_valid CHECK (status IN ('active','removed')),
  CONSTRAINT routine_assignments_unique       UNIQUE (routine_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_ra_routine  ON public.routine_assignments(routine_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_ra_student  ON public.routine_assignments(student_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_ra_updated  ON public.routine_assignments(updated_at DESC);

DROP TRIGGER IF EXISTS trg_ra_updated_at ON public.routine_assignments;
CREATE TRIGGER trg_ra_updated_at
  BEFORE UPDATE ON public.routine_assignments
  FOR EACH ROW EXECUTE FUNCTION public.tg_routine_set_updated_at();

-- --- 3. GRANTs ------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.routine_assignments TO authenticated;
GRANT ALL                             ON public.routine_assignments TO service_role;

-- Fix: original migration missed DELETE on routines — needed by adminDeleteRoutine.
GRANT DELETE ON public.routines TO authenticated;

-- --- 4. RLS ---------------------------------------------------------
ALTER TABLE public.routine_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ra_student_select   ON public.routine_assignments;
DROP POLICY IF EXISTS ra_admin_all        ON public.routine_assignments;

CREATE POLICY ra_student_select ON public.routine_assignments
  FOR SELECT TO authenticated
  USING (student_id = auth.uid() OR public.is_routine_admin(auth.uid()));

CREATE POLICY ra_admin_all ON public.routine_assignments
  FOR ALL TO authenticated
  USING (public.is_routine_admin(auth.uid()))
  WITH CHECK (public.is_routine_admin(auth.uid()));
