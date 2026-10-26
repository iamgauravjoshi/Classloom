import { apiStatusTone } from './api-status';

describe('apiStatusTone', () => {
  it('is checking while the first request is pending', () => {
    expect(apiStatusTone({ isPending: true, isError: false, data: undefined })).toBe('checking');
  });

  it('is online when the latest check succeeded', () => {
    expect(apiStatusTone({ isPending: false, isError: false, data: { status: 'ok' } })).toBe(
      'online',
    );
  });

  // TanStack Query keeps the last good data when a background refetch fails.
  it('is offline when a later refetch fails even though stale data says ok', () => {
    expect(apiStatusTone({ isPending: false, isError: true, data: { status: 'ok' } })).toBe(
      'offline',
    );
  });

  it('is offline when the API reports a degraded dependency', () => {
    expect(apiStatusTone({ isPending: false, isError: false, data: { status: 'error' } })).toBe(
      'offline',
    );
  });
});
