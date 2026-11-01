import { AUTH_EVENT_TYPES, AUTH_METHODS } from '@classloom/contracts';

import { AuthEventType, AuthMethod } from '../../generated/prisma/enums';

describe('contract enums match the Prisma enums', () => {
  it('lists every AuthEventType', () => {
    expect([...AUTH_EVENT_TYPES].sort()).toEqual(Object.values(AuthEventType).sort());
  });

  it('lists every AuthMethod', () => {
    expect([...AUTH_METHODS].sort()).toEqual(Object.values(AuthMethod).sort());
  });
});
