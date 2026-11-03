import { describe, expect, it } from 'vitest';

import {
  formatYmd,
  formStateAfterDateChange,
  initialYearFormState,
  parseDisplayDate,
  stateAfterTermEdit,
  termsAfterConfirm,
  validateYearForm,
  type YearFormState,
} from './year-form-helpers';

const aprilToMarch = (): YearFormState =>
  initialYearFormState({ startsOn: '2026-04-01', endsOn: '2027-03-31' });

describe('display dates', () => {
  it('shows a YYYY-MM-DD date as DD/MM/YYYY and reads it back', () => {
    expect(formatYmd('2027-03-31')).toBe('31/03/2027');
    expect(parseDisplayDate('31/03/2027')).toBe('2027-03-31');
    expect(parseDisplayDate(' 1/4/2026 ')).toBe('2026-04-01');
  });

  it('refuses text that is not a real day', () => {
    expect(parseDisplayDate('31/02/2027')).toBeNull();
    expect(parseDisplayDate('01/04/27')).toBeNull();
    expect(parseDisplayDate('2027-03-31')).toBeNull();
    expect(parseDisplayDate('')).toBeNull();
  });
});

describe('initialYearFormState', () => {
  it('starts with two default terms when none are given', () => {
    const state = aprilToMarch();
    expect(state.termCount).toBe(2);
    expect(state.terms).toEqual([
      { name: 'Term 1', startsOn: '01/04/2026', endsOn: '30/09/2026' },
      { name: 'Term 2', startsOn: '01/10/2026', endsOn: '31/03/2027' },
    ]);
    expect(state.termsEdited).toBe(false);
  });

  it('keeps a year’s own terms, and counts them', () => {
    const state = initialYearFormState({
      startsOn: '2026-04-01',
      endsOn: '2027-03-31',
      terms: [
        { name: 'Summer', startsOn: '2026-04-01', endsOn: '2026-07-31' },
        { name: 'Monsoon', startsOn: '2026-08-01', endsOn: '2026-11-30' },
        { name: 'Winter', startsOn: '2026-12-01', endsOn: '2027-03-31' },
      ],
    });
    expect(state.termCount).toBe(3);
    expect(state.terms[1]).toEqual({
      name: 'Monsoon',
      startsOn: '01/08/2026',
      endsOn: '30/11/2026',
    });
  });
});

describe('formStateAfterDateChange', () => {
  it('regenerates untouched terms when the end date changes', () => {
    const { state, needsConfirm } = formStateAfterDateChange(aprilToMarch(), {
      endsOn: '31/05/2027',
    });
    expect(needsConfirm).toBe(false);
    expect(state.endsOn).toBe('31/05/2027');
    // 14 months: seven each.
    expect(state.terms).toEqual([
      { name: 'Term 1', startsOn: '01/04/2026', endsOn: '31/10/2026' },
      { name: 'Term 2', startsOn: '01/11/2026', endsOn: '31/05/2027' },
    ]);
  });

  it('asks before overwriting an edited term, and leaves the terms as they are', () => {
    const edited: YearFormState = {
      ...aprilToMarch(),
      terms: [
        { name: 'Term 1', startsOn: '01/04/2026', endsOn: '15/10/2026' },
        { name: 'Term 2', startsOn: '16/10/2026', endsOn: '31/03/2027' },
      ],
      termsEdited: true,
    };
    const { state, needsConfirm } = formStateAfterDateChange(edited, { endsOn: '31/05/2027' });
    expect(needsConfirm).toBe(true);
    expect(state.endsOn).toBe('31/05/2027');
    expect(state.terms).toEqual(edited.terms);
    expect(state.termsEdited).toBe(true);
  });

  it('regenerates the terms when switching from 2 to 3', () => {
    const { state, needsConfirm } = formStateAfterDateChange(aprilToMarch(), { termCount: 3 });
    expect(needsConfirm).toBe(false);
    expect(state.termCount).toBe(3);
    expect(state.terms).toEqual([
      { name: 'Term 1', startsOn: '01/04/2026', endsOn: '31/07/2026' },
      { name: 'Term 2', startsOn: '01/08/2026', endsOn: '30/11/2026' },
      { name: 'Term 3', startsOn: '01/12/2026', endsOn: '31/03/2027' },
    ]);
  });

  it('keeps the term names a person typed when it regenerates', () => {
    const named: YearFormState = {
      ...aprilToMarch(),
      terms: aprilToMarch().terms.map((term, i) => ({ ...term, name: `Half ${i + 1}` })),
    };
    const { state } = formStateAfterDateChange(named, { termCount: 3 });
    expect(state.terms.map((term) => term.name)).toEqual(['Half 1', 'Half 2', 'Term 3']);
  });

  it('leaves the terms alone while a date is incomplete or too short to split', () => {
    const typing = formStateAfterDateChange(aprilToMarch(), { endsOn: '31/03/202' });
    expect(typing.needsConfirm).toBe(false);
    expect(typing.state.terms).toEqual(aprilToMarch().terms);

    const short = formStateAfterDateChange(aprilToMarch(), { endsOn: '15/05/2026' });
    expect(short.needsConfirm).toBe(false);
    expect(short.state.terms).toEqual(aprilToMarch().terms);
  });

  it('adds or drops a row when the count changes and the dates cannot be split', () => {
    const typing = { ...aprilToMarch(), endsOn: '' };
    const { state } = formStateAfterDateChange(typing, { termCount: 3 });
    expect(state.terms).toHaveLength(3);
    expect(state.terms[2]).toEqual({ name: 'Term 3', startsOn: '', endsOn: '' });
  });
});

describe('stateAfterTermEdit', () => {
  it('marks a changed date as an edit and moves the next term to the following day', () => {
    const state = stateAfterTermEdit(aprilToMarch(), 0, 'endsOn', '15/10/2026');
    expect(state.termsEdited).toBe(true);
    expect(state.terms[0]?.endsOn).toBe('15/10/2026');
    expect(state.terms[1]?.startsOn).toBe('16/10/2026');
  });

  it('does not count a new name as an edit', () => {
    const state = stateAfterTermEdit(aprilToMarch(), 1, 'name', 'Winter');
    expect(state.termsEdited).toBe(false);
    expect(state.terms[1]?.name).toBe('Winter');
  });
});

describe('termsAfterConfirm', () => {
  it('replaces the terms with the defaults and forgets the edits', () => {
    const edited: YearFormState = { ...aprilToMarch(), endsOn: '31/05/2027', termsEdited: true };
    const state = termsAfterConfirm(edited);
    expect(state.termsEdited).toBe(false);
    expect(state.terms[1]).toEqual({
      name: 'Term 2',
      startsOn: '01/11/2026',
      endsOn: '31/05/2027',
    });
  });
});

describe('validateYearForm', () => {
  it('accepts the defaults, without a label while it is the automatic one', () => {
    const result = validateYearForm(aprilToMarch());
    expect(result).toEqual({
      ok: true,
      body: {
        startsOn: '2026-04-01',
        endsOn: '2027-03-31',
        terms: [
          { name: 'Term 1', startsOn: '2026-04-01', endsOn: '2026-09-30' },
          { name: 'Term 2', startsOn: '2026-10-01', endsOn: '2027-03-31' },
        ],
      },
    });
  });

  it('sends a label the person typed', () => {
    const result = validateYearForm({ ...aprilToMarch(), label: 'AY 2026', labelEdited: true });
    expect(result.ok && result.body.label).toBe('AY 2026');
  });

  it('names the failing field', () => {
    expect(validateYearForm({ ...aprilToMarch(), startsOn: '1 April' })).toMatchObject({
      ok: false,
      errors: { startsOn: 'date' },
    });
    expect(validateYearForm({ ...aprilToMarch(), endsOn: '01/03/2026' })).toMatchObject({
      ok: false,
      errors: { endsOn: 'order' },
    });
    expect(validateYearForm({ ...aprilToMarch(), endsOn: '30/06/2026' })).toMatchObject({
      ok: false,
      errors: { endsOn: 'length' },
    });
    expect(
      validateYearForm({ ...aprilToMarch(), label: 'x'.repeat(21), labelEdited: true }),
    ).toMatchObject({ ok: false, errors: { label: 'label' } });
  });

  it('puts the tiling problem on the failing term row', () => {
    const gap: YearFormState = {
      ...aprilToMarch(),
      terms: [
        { name: 'Term 1', startsOn: '01/04/2026', endsOn: '30/09/2026' },
        { name: 'Term 2', startsOn: '05/10/2026', endsOn: '31/03/2027' },
      ],
    };
    expect(validateYearForm(gap)).toMatchObject({
      ok: false,
      errors: { terms: { 1: { startsOn: 'gap' } } },
    });

    const unnamed: YearFormState = {
      ...aprilToMarch(),
      terms: [{ ...aprilToMarch().terms[0]!, name: ' ' }, aprilToMarch().terms[1]!],
    };
    expect(validateYearForm(unnamed)).toMatchObject({
      ok: false,
      errors: { terms: { 0: { name: 'name' } } },
    });
  });
});
