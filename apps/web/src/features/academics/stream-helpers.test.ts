import { describe, expect, it } from 'vitest';

import messages from '../../../messages/en.json';
import { missingStarterStreams, starterToast } from './stream-helpers';

const stream = (name: string) => ({ name });
const copy = messages.academics.streams;

describe('missingStarterStreams', () => {
  it('lists all three for a school with no streams', () => {
    expect(missingStarterStreams([])).toEqual(['Science', 'Commerce', 'Humanities']);
  });

  it('leaves out the ones the school has, ignoring case, archived or not', () => {
    expect(missingStarterStreams([stream('science'), stream('Vocational')])).toEqual([
      'Commerce',
      'Humanities',
    ]);
    expect(missingStarterStreams([stream('SCIENCE'), stream('Commerce')])).toEqual(['Humanities']);
  });

  it('is empty once the school has all three', () => {
    expect(
      missingStarterStreams([stream('Humanities'), stream('commerce'), stream('Science')]),
    ).toEqual([]);
  });
});

describe('starterToast', () => {
  const created = (...names: string[]) => names.map((name) => ({ name }));

  it('names the streams it added', () => {
    expect(
      starterToast({ created: created('Commerce', 'Humanities'), skipped: ['Science'] }),
    ).toEqual({ key: 'starterAdded', names: 'Commerce and Humanities' });
    expect(copy.starterAdded).toBe('Added {names}.');
  });

  it('says nothing new was added, naming what was already there, when it added none', () => {
    expect(starterToast({ created: [], skipped: ['Science', 'Commerce', 'Humanities'] })).toEqual({
      key: 'starterNoneAdded',
      names: 'Science, Commerce and Humanities',
    });
    expect(copy.starterNoneAdded).toBe('Nothing new was added. Already here: {names}.');
  });

  it('falls back to a plain message with nothing created or skipped', () => {
    expect(starterToast({ created: [], skipped: [] })).toEqual({ key: 'starterNothingNew' });
    expect(copy.starterNothingNew).toBe('Nothing new was added.');
  });
});
