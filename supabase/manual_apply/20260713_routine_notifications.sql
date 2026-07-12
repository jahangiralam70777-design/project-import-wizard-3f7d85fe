-- =====================================================================
-- Routine Notification System — Standalone Additive Migration
-- Adds automatic morning/night reminder infrastructure for the Routine
-- Management module. Fully isolated from all other domains (MCQ, Quiz,
-- Mock Test, Custom Exam, Wrong Questions, Bookmarks, Analytics,
-- Progress, Dashboard, Leaderboard, Notification Center master data,
-- Live Chat conversations).
--
-- Rules honoured:
--   * ADDITIVE ONLY — no ALTER/DROP on any existing table.
--   * All new objects prefixed with `routine_notification_`.
--   * Idempotent — safe to re-run.
--   * Enables RLS and grants required for Data API (PostgREST) access.
--   * All timestamps are UTC.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1) Settings — singleton row keyed by id = 1
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.routine_notification_settings (
  id                       smallint      PRIMARY KEY DEFAULT 1
                                          CHECK (id = 1),
  enabled                  boolean       NOT NULL DEFAULT true,
  timezone                 text          NOT NULL DEFAULT 'Asia/Dhaka',
  morning_time             time          NOT NULL DEFAULT '09:00',
  night_time               time          NOT NULL DEFAULT '22:00',
  deliver_notification_center boolean    NOT NULL DEFAULT true,
  deliver_live_chat        boolean       NOT NULL DEFAULT false,
  quiet_start              time,
  quiet_end                time,
  weekly_summary_enabled   boolean       NOT NULL DEFAULT false,
  weekly_summary_day       smallint      NOT NULL DEFAULT 0
                                          CHECK (weekly_summary_day BETWEEN 0 AND 6),
  weekly_summary_time      time          NOT NULL DEFAULT '20:00',
  created_at               timestamptz   NOT NULL DEFAULT now(),
  updated_at               timestamptz   NOT NULL DEFAULT now()
);

GRANT SELECT                          ON public.routine_notification_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE  ON public.routine_notification_settings TO service_role;
GRANT ALL                             ON public.routine_notification_settings TO service_role;

ALTER TABLE public.routine_notification_settings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='routine_notification_settings'
      AND policyname='routine_notif_settings_admin_all'
  ) THEN
    CREATE POLICY routine_notif_settings_admin_all
      ON public.routine_notification_settings
      FOR ALL TO authenticated
      USING (public.is_routine_admin(auth.uid()))
      WITH CHECK (public.is_routine_admin(auth.uid()));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='routine_notification_settings'
      AND policyname='routine_notif_settings_read_auth'
  ) THEN
    CREATE POLICY routine_notif_settings_read_auth
      ON public.routine_notification_settings
      FOR SELECT TO authenticated
      USING (true);
  END IF;
END $$;

INSERT INTO public.routine_notification_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------
-- 2) Templates — one row per notification kind
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.routine_notification_templates (
  id           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         text         NOT NULL UNIQUE
                             CHECK (kind IN ('morning_reminder','night_progress','weekly_summary')),
  title        text         NOT NULL,
  body         text         NOT NULL,
  enabled      boolean      NOT NULL DEFAULT true,
  updated_by   uuid,
  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now()
);

GRANT SELECT                          ON public.routine_notification_templates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE  ON public.routine_notification_templates TO service_role;

ALTER TABLE public.routine_notification_templates ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='routine_notif_tpl_admin_all') THEN
    CREATE POLICY routine_notif_tpl_admin_all
      ON public.routine_notification_templates
      FOR ALL TO authenticated
      USING (public.is_routine_admin(auth.uid()))
      WITH CHECK (public.is_routine_admin(auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='routine_notif_tpl_read_auth') THEN
    CREATE POLICY routine_notif_tpl_read_auth
      ON public.routine_notification_templates
      FOR SELECT TO authenticated
      USING (true);
  END IF;
END $$;

INSERT INTO public.routine_notification_templates (kind, title, body)
VALUES
  ('morning_reminder',
   '🌅 Good morning! Your study plan for today',
   'Hi {name}, today''s target: {study_hours}h study & {mcq_target} MCQs. Current streak: 🔥 {streak} days. Let''s make it count!'),
  ('night_progress',
   '🌙 Today''s progress — {status_emoji} {status}',
   'You studied {study_done}/{study_hours}h and solved {mcqs_done}/{mcq_target} MCQs today ({completion_pct}%). {remaining_hint}'),
  ('weekly_summary',
   '📊 Weekly routine summary',
   'This week: {completion_pct}% completion. {completed_days} completed / {missed_days} missed. Longest streak: {longest_streak}.')
ON CONFLICT (kind) DO NOTHING;

-- ---------------------------------------------------------------------
-- 3) Performance tiers — configurable completion ranges
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.routine_notification_tiers (
  id           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  key          text         NOT NULL UNIQUE,
  label        text         NOT NULL,
  emoji        text         NOT NULL DEFAULT '',
  min_pct      smallint     NOT NULL CHECK (min_pct BETWEEN 0 AND 100),
  max_pct      smallint     NOT NULL CHECK (max_pct BETWEEN 0 AND 100),
  color        text         NOT NULL DEFAULT '#64748b',
  sort_order   smallint     NOT NULL DEFAULT 0,
  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now(),
  CHECK (max_pct >= min_pct)
);

GRANT SELECT                          ON public.routine_notification_tiers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE  ON public.routine_notification_tiers TO service_role;

ALTER TABLE public.routine_notification_tiers ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='routine_notif_tiers_admin_all') THEN
    CREATE POLICY routine_notif_tiers_admin_all
      ON public.routine_notification_tiers
      FOR ALL TO authenticated
      USING (public.is_routine_admin(auth.uid()))
      WITH CHECK (public.is_routine_admin(auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='routine_notif_tiers_read_auth') THEN
    CREATE POLICY routine_notif_tiers_read_auth
      ON public.routine_notification_tiers
      FOR SELECT TO authenticated
      USING (true);
  END IF;
END $$;

INSERT INTO public.routine_notification_tiers (key, label, emoji, min_pct, max_pct, color, sort_order)
VALUES
  ('excellent',   'Excellent',   '🏆',  90, 100, '#16a34a', 1),
  ('good',        'Good',        '💪',  70,  89, '#0ea5e9', 2),
  ('average',     'Average',     '⚡',  50,  69, '#f59e0b', 3),
  ('below',       'Below Target','🐢',  20,  49, '#f97316', 4),
  ('missed',      'Missed Day',  '❌',   0,  19, '#dc2626', 5)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------
-- 4) Delivery log (append-only, dedup key)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.routine_notification_log (
  id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid         NOT NULL,
  kind              text         NOT NULL,
  channel           text         NOT NULL,
  target_date       date         NOT NULL,
  dedup_key         text         NOT NULL,
  status            text         NOT NULL DEFAULT 'sent'
                                  CHECK (status IN ('sent','failed','skipped')),
  error             text,
  payload           jsonb        NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz  NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS routine_notification_log_dedup_idx
  ON public.routine_notification_log (dedup_key);
CREATE INDEX IF NOT EXISTS routine_notification_log_user_date_idx
  ON public.routine_notification_log (user_id, target_date DESC);

GRANT SELECT                          ON public.routine_notification_log TO authenticated;
GRANT SELECT, INSERT                  ON public.routine_notification_log TO service_role;
GRANT ALL                             ON public.routine_notification_log TO service_role;

ALTER TABLE public.routine_notification_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='routine_notif_log_admin_read') THEN
    CREATE POLICY routine_notif_log_admin_read
      ON public.routine_notification_log
      FOR SELECT TO authenticated
      USING (public.is_routine_admin(auth.uid()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname='routine_notif_log_owner_read') THEN
    CREATE POLICY routine_notif_log_owner_read
      ON public.routine_notification_log
      FOR SELECT TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 5) updated_at triggers
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_routine_notif_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_routine_notif_settings_touch') THEN
    CREATE TRIGGER trg_routine_notif_settings_touch
    BEFORE UPDATE ON public.routine_notification_settings
    FOR EACH ROW EXECUTE FUNCTION public.tg_routine_notif_touch_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_routine_notif_tpl_touch') THEN
    CREATE TRIGGER trg_routine_notif_tpl_touch
    BEFORE UPDATE ON public.routine_notification_templates
    FOR EACH ROW EXECUTE FUNCTION public.tg_routine_notif_touch_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trg_routine_notif_tiers_touch') THEN
    CREATE TRIGGER trg_routine_notif_tiers_touch
    BEFORE UPDATE ON public.routine_notification_tiers
    FOR EACH ROW EXECUTE FUNCTION public.tg_routine_notif_touch_updated_at();
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 6) pg_cron scheduler — runs every 15 minutes; the endpoint decides
--    whether the current time matches the configured morning/night slot.
--    Requires pg_cron + pg_net extensions to be enabled.
--
--    Replace {PROJECT_URL} and {ROUTINE_NOTIFICATIONS_SECRET} with your
--    stable published URL and the secret you set in the app env.
-- ---------------------------------------------------------------------
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_net') THEN
    PERFORM cron.unschedule('routine-notifications-tick')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='routine-notifications-tick');
    PERFORM cron.schedule(
      'routine-notifications-tick',
      '*/15 * * * *',
      $$
      SELECT net.http_post(
        url     := '{PROJECT_URL}/api/public/routine-notifications-tick',
        headers := '{"Content-Type":"application/json","Authorization":"Bearer {ROUTINE_NOTIFICATIONS_SECRET}"}'::jsonb,
        body    := '{}'::jsonb
      );
      $$
    );
  END IF;
END $cron$;

COMMIT;