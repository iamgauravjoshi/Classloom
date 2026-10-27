-- Added by hand. Hardens the two SECURITY DEFINER functions.
-- They rely on their owner (classloom_owner) having BYPASSRLS: memberships are under forced
-- row-level security, so without it the "no membership in any school" check would see no rows and
-- delete users who belong to active schools. With row_security off, a query that row-level
-- security would filter raises an error instead, so a misconfigured owner fails loudly.
ALTER FUNCTION purge_pending_registrations(timestamptz) SET row_security = off;
ALTER FUNCTION cancel_pending_registration(bytea) SET row_security = off;
