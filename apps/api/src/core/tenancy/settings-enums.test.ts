import { NUMBER_SERIES_KEYS, NUMBER_SERIES_RESETS } from '@classloom/contracts';

import { NumberSeriesKey, NumberSeriesReset } from '../../generated/prisma/enums';

// The Prisma enums are declared in prisma/schema/settings.prisma; their values must equal the
// contract lists the API validates against.
describe('settings enums match @classloom/contracts', () => {
  it('NumberSeriesKey equals NUMBER_SERIES_KEYS', () => {
    expect(Object.values(NumberSeriesKey)).toEqual([...NUMBER_SERIES_KEYS]);
  });

  it('NumberSeriesReset equals NUMBER_SERIES_RESETS', () => {
    expect(Object.values(NumberSeriesReset)).toEqual([...NUMBER_SERIES_RESETS]);
  });
});
