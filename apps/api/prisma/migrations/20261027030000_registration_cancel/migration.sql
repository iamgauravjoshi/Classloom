-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "cancel_token_hash" BYTEA;

-- CreateIndex
CREATE UNIQUE INDEX "tenants_cancel_token_hash_key" ON "tenants"("cancel_token_hash");

-- ---------------------------------------------------------------------------------------------
-- Added by hand. "Use a different email" on the registration page.
-- ---------------------------------------------------------------------------------------------
-- Withdraws a registration that is still PENDING_VERIFICATION, given the SHA-256 of the cancel
-- token returned only to the registering browser. Campuses, memberships and tokens cascade; the
-- school's users are deleted too when that leaves them with no membership in any school and no
-- verified email. Returns whether a registration was withdrawn (the API ignores it and always
-- answers 204).
--
-- SECURITY DEFINER for the same reason as purge_pending_registrations: the orphan check must see
-- every school's memberships, which row-level security hides from the app role. Locking the
-- tenant row first serialises it against a concurrent verification: whichever commits first wins,
-- and a verified school is never deleted.
CREATE FUNCTION cancel_pending_registration(p_cancel_token_hash bytea)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  cancelled uuid;
  member_ids uuid[];
BEGIN
  SELECT t.id INTO cancelled
    FROM public.tenants AS t
   WHERE t.cancel_token_hash = p_cancel_token_hash
     AND t.status = 'PENDING_VERIFICATION'
     FOR UPDATE;
  IF cancelled IS NULL THEN
    RETURN false;
  END IF;

  SELECT array_agg(m.user_id) INTO member_ids
    FROM public.memberships AS m
   WHERE m.tenant_id = cancelled;

  DELETE FROM public.tenants AS t WHERE t.id = cancelled;

  DELETE FROM public.users AS u
   WHERE u.id = ANY (member_ids)
     AND u.email_verified_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.memberships AS m WHERE m.user_id = u.id);

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION cancel_pending_registration(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cancel_pending_registration(bytea) TO classloom_app;
