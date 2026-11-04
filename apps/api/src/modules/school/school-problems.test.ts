import { LogoInvalidException } from './school-problems';

describe('LogoInvalidException', () => {
  it('words reason dimensions neutrally: it covers too small and over 25 megapixels', () => {
    expect(new LogoInvalidException('dimensions').getResponse()).toMatchObject({
      type: 'logo-invalid',
      reason: 'dimensions',
      message: 'The image must be between 64 pixels on each side and 25 megapixels.',
    });
  });
});
