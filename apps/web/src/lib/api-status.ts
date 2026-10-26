export type ApiStatusTone = 'checking' | 'online' | 'offline';

/**
 * Health-pill state. TanStack Query keeps the last good `data` when a background refetch fails,
 * so a failed latest check must win over stale `status: 'ok'`.
 */
export function apiStatusTone(query: {
  isPending: boolean;
  isError: boolean;
  data: { status: string } | undefined;
}): ApiStatusTone {
  if (query.isPending) return 'checking';
  return !query.isError && query.data?.status === 'ok' ? 'online' : 'offline';
}
