-- =====================================================================
-- Routine Management Module — production schema (self-contained).
-- Depends only on auth.users; all other integrations are optional and
-- resolved at runtime so this migration succeeds on a fresh project.
-- =====================================================================

-- Extension required for trigram search on routine names / session titles.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- --------------------------------------------------------------------
-- Common trigger helper: refresh updated_at on any UPDATE.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_routine_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- --------------------------------------------------------------------
-- Admin check: defers to public.has_role / public.app_role when the
-- project provides them; falls back to false otherwise.
-- --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_routine_admin(_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  result boolean := false;
BEGIN
  BEGIN
    EXECUTE 'SELECT public.has_role($1, ''admin''::public.app_role) OR public.has_role($1, ''moderator''::public.app_role)'
      INTO result USING _user_id;
  EXCEPTION WHEN OTHERS THEN
    result := false;
  END;
  RETURN COALESCE(result, false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_routine_admin(uuid) TO authenticated;

-- ====================================================================
-- 1. routines
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.routines (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text NOT NULL,
  description           text,

  scope_level           text NOT NULL,
  scope_subject_id      uuid,
  scope_chapter_id      uuid,

  start_date            date,
  end_date              date,

  active_days           text[] NOT NULL DEFAULT ARRAY[]::text[],

  study_target_minutes  integer NOT NULL DEFAULT 0,
  mcq_target            integer NOT NULL DEFAULT 0,

  status                text NOT NULL DEFAULT 'active',

  version               integer NOT NULL DEFAULT 1,
  is_current            boolean NOT NULL DEFAULT true,
  previous_version_id   uuid,
  created_from_id       uuid,

  created_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  deleted_at            timestamptz,
  deleted_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  CONSTRAINT routines_name_not_blank         CHECK (btrim(name) <> ''),
  CONSTRAINT routines_status_valid           CHECK (status IN ('active','disabled','archived')),
  CONSTRAINT routines_study_nonneg           CHECK (study_target_minutes >= 0 AND study_target_minutes <= 1440),
  CONSTRAINT routines_mcq_nonneg             CHECK (mcq_target >= 0 AND mcq_target <= 100000),
  CONSTRAINT routines_date_window            CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date),
  CONSTRAINT routines_version_pos            CHECK (version >= 1),
  CONSTRAINT routines_chapter_needs_subject  CHECK (scope_chapter_id IS NULL OR scope_subject_id IS NOT NULL),
  CONSTRAINT routines_active_days_valid      CHECK (active_days <@ ARRAY['sun','mon','tue','wed','thu','fri','sat']::text[])
);

-- Self-references for versioning.
ALTER TABLE public.routines
  ADD CONSTRAINT routines_previous_version_fk FOREIGN KEY (previous_version_id) REFERENCES public.routines(id) ON DELETE SET NULL,
  ADD CONSTRAINT routines_created_from_fk     FOREIGN KEY (created_from_id)     REFERENCES public.routines(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_routines_status       ON public.routines(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_routines_level        ON public.routines(scope_level) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_routines_subject      ON public.routines(scope_subject_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_routines_chapter      ON public.routines(scope_chapter_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_routines_created_at   ON public.routines(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_routines_updated_at   ON public.routines(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_routines_start_date   ON public.routines(start_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_routines_end_date     ON public.routines(end_date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_routines_active_scope ON public.routines(scope_level, scope_subject_id, scope_chapter_id)
  WHERE status = 'active' AND deleted_at IS NULL AND is_current = true;
CREATE INDEX IF NOT EXISTS idx_routines_name_trgm    ON public.routines USING gin (lower(name) gin_trgm_ops);

-- Unique active scope (soft-delete aware; NULL-safe via COALESCE sentinel).
CREATE UNIQUE INDEX IF NOT EXISTS uq_routines_active_scope
  ON public.routines (
    scope_level,
    COALESCE(scope_subject_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(scope_chapter_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE status = 'active' AND deleted_at IS NULL AND is_current = true;

CREATE TRIGGER trg_routines_updated_at
  BEFORE UPDATE ON public.routines
  FOR EACH ROW EXECUTE FUNCTION public.tg_routine_set_updated_at();

-- ====================================================================
-- 2. routine_versions — immutable historical snapshots
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.routine_versions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  routine_id  uuid NOT NULL REFERENCES public.routines(id) ON DELETE CASCADE,
  version     integer NOT NULL,
  snapshot    jsonb   NOT NULL,
  changed_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (routine_id, version)
);
CREATE INDEX IF NOT EXISTS idx_routine_versions_routine ON public.routine_versions(routine_id, version DESC);

CREATE OR REPLACE FUNCTION public.tg_routine_capture_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  next_version integer;
BEGIN
  IF (TG_OP = 'UPDATE') THEN
    IF row_to_json(OLD)::jsonb - 'updated_at' = row_to_json(NEW)::jsonb - 'updated_at' THEN
      RETURN NEW;
    END IF;
    SELECT COALESCE(MAX(version), OLD.version) + 1 INTO next_version
    FROM public.routine_versions WHERE routine_id = OLD.id;
    INSERT INTO public.routine_versions (routine_id, version, snapshot, changed_by)
    VALUES (OLD.id, OLD.version, to_jsonb(OLD), NEW.updated_by);
    NEW.version := next_version;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_routines_capture_version
  BEFORE UPDATE ON public.routines
  FOR EACH ROW EXECUTE FUNCTION public.tg_routine_capture_version();

-- ====================================================================
-- 3. routine_daily_progress
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.routine_daily_progress (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  routine_id      uuid NOT NULL REFERENCES public.routines(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date            date NOT NULL,
  study_minutes   integer NOT NULL DEFAULT 0,
  mcqs_solved     integer NOT NULL DEFAULT 0,
  completion_pct  numeric(5,2) NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'in_progress',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  deleted_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  CONSTRAINT rdp_study_nonneg   CHECK (study_minutes >= 0 AND study_minutes <= 1440),
  CONSTRAINT rdp_mcqs_nonneg    CHECK (mcqs_solved >= 0 AND mcqs_solved <= 100000),
  CONSTRAINT rdp_completion_pct CHECK (completion_pct >= 0 AND completion_pct <= 100),
  CONSTRAINT rdp_status_valid   CHECK (status IN ('not_started','in_progress','completed','missed')),
  CONSTRAINT rdp_unique_day     UNIQUE (routine_id, user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_rdp_user_date    ON public.routine_daily_progress(user_id, date DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_rdp_routine_date ON public.routine_daily_progress(routine_id, date DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_rdp_date         ON public.routine_daily_progress(date) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_rdp_status       ON public.routine_daily_progress(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_rdp_updated_at   ON public.routine_daily_progress(updated_at DESC);

CREATE TRIGGER trg_rdp_updated_at
  BEFORE UPDATE ON public.routine_daily_progress
  FOR EACH ROW EXECUTE FUNCTION public.tg_routine_set_updated_at();

-- ====================================================================
-- 4. routine_study_sessions
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.routine_study_sessions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  routine_id        uuid NOT NULL REFERENCES public.routines(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date              date NOT NULL,
  title             text NOT NULL,
  duration_minutes  integer NOT NULL,
  mcqs_solved       integer NOT NULL DEFAULT 0,
  notes             text,
  start_time        time,
  end_time          time,
  status            text NOT NULL DEFAULT 'pending',
  admin_notes       text,
  reviewed_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  deleted_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,

  CONSTRAINT rss_title_not_blank    CHECK (btrim(title) <> ''),
  CONSTRAINT rss_duration_pos       CHECK (duration_minutes > 0 AND duration_minutes <= 1440),
  CONSTRAINT rss_mcqs_nonneg        CHECK (mcqs_solved >= 0 AND mcqs_solved <= 100000),
  CONSTRAINT rss_time_window        CHECK (start_time IS NULL OR end_time IS NULL OR end_time > start_time),
  CONSTRAINT rss_status_valid       CHECK (status IN ('pending','approved','rejected')),
  CONSTRAINT rss_review_consistency CHECK (
    (status = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR status IN ('approved','rejected')
  )
);

CREATE INDEX IF NOT EXISTS idx_rss_user_date      ON public.routine_study_sessions(user_id, date DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_rss_routine_date   ON public.routine_study_sessions(routine_id, date DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_rss_status         ON public.routine_study_sessions(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_rss_status_created ON public.routine_study_sessions(status, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_rss_reviewed_by    ON public.routine_study_sessions(reviewed_by) WHERE reviewed_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rss_title_trgm     ON public.routine_study_sessions USING gin (lower(title) gin_trgm_ops);

CREATE TRIGGER trg_rss_updated_at
  BEFORE UPDATE ON public.routine_study_sessions
  FOR EACH ROW EXECUTE FUNCTION public.tg_routine_set_updated_at();

-- ====================================================================
-- 5. routine_activity_log — append-only audit
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.routine_activity_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action       text NOT NULL,
  entity_type  text NOT NULL,
  entity_id    uuid,
  description  text,
  metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ral_action_not_blank      CHECK (btrim(action) <> ''),
  CONSTRAINT ral_entity_type_not_blank CHECK (btrim(entity_type) <> '')
);

CREATE INDEX IF NOT EXISTS idx_ral_created_at ON public.routine_activity_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ral_actor      ON public.routine_activity_log(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ral_entity     ON public.routine_activity_log(entity_type, entity_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.tg_routine_activity_log_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'routine_activity_log is append-only';
END;
$$;

CREATE TRIGGER trg_ral_no_update BEFORE UPDATE ON public.routine_activity_log
  FOR EACH ROW EXECUTE FUNCTION public.tg_routine_activity_log_immutable();
CREATE TRIGGER trg_ral_no_delete BEFORE DELETE ON public.routine_activity_log
  FOR EACH ROW EXECUTE FUNCTION public.tg_routine_activity_log_immutable();

-- ====================================================================
-- 6. routine_notifications
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.routine_notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type        text NOT NULL,
  title       text NOT NULL,
  body        text,
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT rn_type_not_blank  CHECK (btrim(type) <> ''),
  CONSTRAINT rn_title_not_blank CHECK (btrim(title) <> '')
);

CREATE INDEX IF NOT EXISTS idx_rn_user_created ON public.routine_notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rn_user_unread  ON public.routine_notifications(user_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_rn_type         ON public.routine_notifications(type);

-- ====================================================================
-- GRANTS — Data API access. RLS enforces per-user scoping below.
-- ====================================================================
GRANT SELECT, INSERT, UPDATE          ON public.routines               TO authenticated;
GRANT SELECT, INSERT                  ON public.routine_versions       TO authenticated;
GRANT SELECT, INSERT, UPDATE          ON public.routine_daily_progress TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE  ON public.routine_study_sessions TO authenticated;
GRANT SELECT, INSERT                  ON public.routine_activity_log   TO authenticated;
GRANT SELECT, INSERT, UPDATE          ON public.routine_notifications  TO authenticated;

GRANT ALL ON public.routines               TO service_role;
GRANT ALL ON public.routine_versions       TO service_role;
GRANT ALL ON public.routine_daily_progress TO service_role;
GRANT ALL ON public.routine_study_sessions TO service_role;
GRANT ALL ON public.routine_activity_log   TO service_role;
GRANT ALL ON public.routine_notifications  TO service_role;

-- ====================================================================
-- RLS
-- ====================================================================
ALTER TABLE public.routines               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.routine_versions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.routine_daily_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.routine_study_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.routine_activity_log   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.routine_notifications  ENABLE ROW LEVEL SECURITY;

-- ---- routines ------------------------------------------------------
-- Signed-in users can read active, current, non-deleted routines. The
-- backend refines the list by profile.level before returning to students.
CREATE POLICY routines_signed_in_read ON public.routines
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND status = 'active' AND is_current = true);

CREATE POLICY routines_admin_all ON public.routines
  FOR ALL TO authenticated
  USING (public.is_routine_admin(auth.uid()))
  WITH CHECK (public.is_routine_admin(auth.uid()));

-- ---- routine_versions ---------------------------------------------
CREATE POLICY routine_versions_admin_read ON public.routine_versions
  FOR SELECT TO authenticated
  USING (public.is_routine_admin(auth.uid()));

CREATE POLICY routine_versions_admin_write ON public.routine_versions
  FOR INSERT TO authenticated
  WITH CHECK (public.is_routine_admin(auth.uid()));

-- ---- routine_daily_progress ---------------------------------------
CREATE POLICY rdp_owner_select ON public.routine_daily_progress
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_routine_admin(auth.uid()));

CREATE POLICY rdp_owner_insert ON public.routine_daily_progress
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY rdp_owner_update ON public.routine_daily_progress
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY rdp_admin_all ON public.routine_daily_progress
  FOR ALL TO authenticated
  USING (public.is_routine_admin(auth.uid()))
  WITH CHECK (public.is_routine_admin(auth.uid()));

-- ---- routine_study_sessions ---------------------------------------
CREATE POLICY rss_owner_select ON public.routine_study_sessions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_routine_admin(auth.uid()));

CREATE POLICY rss_owner_insert ON public.routine_study_sessions
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND status = 'pending');

CREATE POLICY rss_owner_update ON public.routine_study_sessions
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND status = 'pending')
  WITH CHECK (user_id = auth.uid() AND status = 'pending');

CREATE POLICY rss_owner_delete ON public.routine_study_sessions
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND status = 'pending');

CREATE POLICY rss_admin_all ON public.routine_study_sessions
  FOR ALL TO authenticated
  USING (public.is_routine_admin(auth.uid()))
  WITH CHECK (public.is_routine_admin(auth.uid()));

-- ---- routine_activity_log -----------------------------------------
CREATE POLICY ral_actor_insert ON public.routine_activity_log
  FOR INSERT TO authenticated
  WITH CHECK (actor_id = auth.uid() OR public.is_routine_admin(auth.uid()));

CREATE POLICY ral_owner_select ON public.routine_activity_log
  FOR SELECT TO authenticated
  USING (actor_id = auth.uid() OR public.is_routine_admin(auth.uid()));

-- ---- routine_notifications ----------------------------------------
CREATE POLICY rn_owner_select ON public.routine_notifications
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_routine_admin(auth.uid()));

CREATE POLICY rn_owner_mark_read ON public.routine_notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY rn_admin_all ON public.routine_notifications
  FOR ALL TO authenticated
  USING (public.is_routine_admin(auth.uid()))
  WITH CHECK (public.is_routine_admin(auth.uid()));

-- ====================================================================
-- Reporting view — RLS applies via SECURITY INVOKER (default).
-- ====================================================================
CREATE OR REPLACE VIEW public.v_routine_daily_rollup AS
SELECT
  rdp.user_id,
  rdp.routine_id,
  rdp.date,
  SUM(rdp.study_minutes)::integer AS study_minutes,
  SUM(rdp.mcqs_solved)::integer   AS mcqs_solved,
  MAX(rdp.completion_pct)         AS completion_pct,
  MAX(rdp.status)                 AS status
FROM public.routine_daily_progress rdp
WHERE rdp.deleted_at IS NULL
GROUP BY rdp.user_id, rdp.routine_id, rdp.date;

GRANT SELECT ON public.v_routine_daily_rollup TO authenticated, service_role;

-- ====================================================================
-- Health check helper.
-- ====================================================================
CREATE OR REPLACE FUNCTION public.routine_health_check()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'ok', true,
    'tables', jsonb_build_object(
      'routines',               (to_regclass('public.routines')               IS NOT NULL),
      'routine_versions',       (to_regclass('public.routine_versions')       IS NOT NULL),
      'routine_daily_progress', (to_regclass('public.routine_daily_progress') IS NOT NULL),
      'routine_study_sessions', (to_regclass('public.routine_study_sessions') IS NOT NULL),
      'routine_activity_log',   (to_regclass('public.routine_activity_log')   IS NOT NULL),
      'routine_notifications',  (to_regclass('public.routine_notifications')  IS NOT NULL)
    ),
    'checked_at', now()
  );
$$;

GRANT EXECUTE ON FUNCTION public.routine_health_check() TO authenticated, anon, service_role;
-- ============================================================
-- Security linter follow-up
-- ============================================================
-- 1. View must run with caller's RLS.
ALTER VIEW public.v_routine_daily_rollup SET (security_invoker = true);

-- 2. Move pg_trgm out of public.
CREATE SCHEMA IF NOT EXISTS extensions;
ALTER EXTENSION pg_trgm SET SCHEMA extensions;

-- 3. Revoke public/anon/authenticated EXECUTE from SECURITY DEFINER helpers.
--    RLS still calls them because policies execute as the table owner.
REVOKE ALL ON FUNCTION public.is_routine_admin(uuid)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.routine_health_check()  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_routine_admin(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.routine_health_check() TO service_role;