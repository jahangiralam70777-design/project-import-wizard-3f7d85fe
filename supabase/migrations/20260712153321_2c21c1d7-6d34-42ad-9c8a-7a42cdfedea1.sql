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