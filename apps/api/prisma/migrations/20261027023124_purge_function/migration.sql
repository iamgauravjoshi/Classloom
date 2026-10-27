-- Added by hand. Spec section 7, "Expiry clean-up".
-- ---------------------------------------------------------------------------------------------
-- Deletes registrations still PENDING_VERIFICATION that were created before `cutoff`, then
-- users with no membership in any school and no verified email.
--
-- The API runs as classloom_app, which is under row-level security: it cannot see other
-- schools' memberships, so it cannot tell whether a user still belongs to an active school.
-- Rather than give the API the owner credential, this function is SECURITY DEFINER: it runs
-- with the rights of its owner (classloom_owner, BYPASSRLS), and the app role may only call it.
-- A pinned search_path stops a caller from substituting its own tables or operators.
CREATE FUNCTION purge_pending_registrations(cutoff timestamptz)
RETURNS TABLE (tenants integer, users integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  purged_tenants integer;
  purged_users integer;
BEGIN
  -- Campuses, memberships and registration tokens cascade with the tenant.
  DELETE FROM public.tenants AS t
   WHERE t.status = 'PENDING_VERIFICATION' AND t.created_at < cutoff;
  GET DIAGNOSTICS purged_tenants = ROW_COUNT;

  DELETE FROM public.users AS u
   WHERE u.email_verified_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.memberships AS m WHERE m.user_id = u.id);
  GET DIAGNOSTICS purged_users = ROW_COUNT;

  RETURN QUERY SELECT purged_tenants, purged_users;
END;
$$;

REVOKE ALL ON FUNCTION purge_pending_registrations(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purge_pending_registrations(timestamptz) TO classloom_app;
