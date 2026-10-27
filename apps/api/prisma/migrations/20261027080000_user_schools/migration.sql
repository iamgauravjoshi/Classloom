-- Added by hand. Spec section 7, "Forgot and reset".
-- ---------------------------------------------------------------------------------------------
-- Every school a user has a membership in, across schools: its code, and whether the membership
-- is ACTIVE in an ACTIVE school. Password reset needs both: "is this user allowed a link" and
-- "which school codes must the new password avoid".
--
-- Memberships are under forced row-level security and the API has no tenant context at that
-- point, so, as with purge_pending_registrations, this is SECURITY DEFINER (owner has BYPASSRLS)
-- with row_security off, so a misconfigured owner fails loudly. The app role may only call it,
-- and it only discloses the caller's own lookup result to server code, never to a client.
CREATE FUNCTION user_schools(p_user_id uuid)
RETURNS TABLE (code text, eligible boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
  SELECT t.code, (m.status = 'ACTIVE' AND t.status = 'ACTIVE')
    FROM public.memberships AS m
    JOIN public.tenants AS t ON t.id = m.tenant_id
   WHERE m.user_id = p_user_id;
$$;

REVOKE ALL ON FUNCTION user_schools(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION user_schools(uuid) TO classloom_app;
