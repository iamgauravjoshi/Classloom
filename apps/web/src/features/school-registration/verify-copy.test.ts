import messages from '../../../messages/en.json';

const verify = messages.registration.verify;

describe('verification page copy for a link that no longer works', () => {
  it('keeps "no longer valid" in the heading', () => {
    expect(verify.invalidTitle).toContain('no longer valid');
  });

  it('tells a used-link visitor the school is ready and an expired-link visitor what to do', () => {
    expect(verify.invalidBody).toBe(
      'If you already opened this link, your school is ready and sign-in arrives soon. ' +
        'If it expired, request a new link below.',
    );
  });
});
