import { STARTER_STREAMS } from '@classloom/contracts';

import { formatList } from './academics-errors';

/**
 * The starter streams (Science, Commerce, Humanities) the school doesn't have yet, comparing names
 * without case and counting archived streams, as `POST /academics/streams/starter` does.
 */
export function missingStarterStreams(streams: readonly { name: string }[]): string[] {
  const names = new Set(streams.map((stream) => stream.name.toLowerCase()));
  return STARTER_STREAMS.filter((name) => !names.has(name.toLowerCase()));
}

/** The `academics.streams` toast after adding the starter streams, and the names it needs. */
export function starterToast(added: {
  created: readonly { name: string }[];
  skipped: readonly string[];
}): { key: 'starterAdded' | 'starterNoneAdded'; names: string } | { key: 'starterNothingNew' } {
  if (added.created.length > 0) {
    return { key: 'starterAdded', names: formatList(added.created.map((s) => s.name)) };
  }
  if (added.skipped.length > 0)
    return { key: 'starterNoneAdded', names: formatList(added.skipped) };
  return { key: 'starterNothingNew' };
}
