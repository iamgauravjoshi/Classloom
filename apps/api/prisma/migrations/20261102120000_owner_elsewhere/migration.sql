-- Added by hand. Spec section 7 (reset two-step across schools).
-- ---------------------------------------------------------------------------------------------
-- True when the user holds the Owner role through an ACTIVE membership in a school other than
-- p_except_tenant_id. A school admin's two-step reset is user-level (it ends the person's sessions
-- at every school), so it must not reach an owner of another school. Memberships are under forced
-- row-level security, so, as with user_schools, this is SECURITY DEFINER with row_security off;
-- the app role may only call it.
CREATE FUNCTION user_is_owner_elsewhere(p_user_id uuid, p_except_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.memberships AS m
      JOIN public.membership_roles AS mr ON mr.membership_id = m.id
      JOIN public.roles AS r ON r.id = mr.role_id
     WHERE m.user_id = p_user_id
       AND m.tenant_id <> p_except_tenant_id
       AND m.status = 'ACTIVE'
       AND r.key = 'OWNER'
  );
$$;

REVOKE ALL ON FUNCTION user_is_owner_elsewhere(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION user_is_owner_elsewhere(uuid, uuid) TO classloom_app;
