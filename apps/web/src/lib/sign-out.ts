import { ApiError } from '@classloom/api-client';

/**
 * Whether to leave the app after a sign-out call settled with `error` (`null` on success). A `401`
 * means the session had already ended; anything else may leave it live, so stay and say so.
 */
export function leavesAfterSignOut(error: unknown): boolean {
  return error === null || (error instanceof ApiError && error.status === 401);
}
