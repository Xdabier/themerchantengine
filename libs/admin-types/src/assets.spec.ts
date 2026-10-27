import { assetOriginalUrlResponseSchema } from './assets';

describe('assetOriginalUrlResponseSchema', () => {
  it('parses a valid signed-URL response', () => {
    const payload = {
      url: 'https://example.com/private/abc?token=xyz&exp=1746000000',
      expiresAt: '2026-05-01T12:34:56.000Z',
    };
    expect(() => assetOriginalUrlResponseSchema.parse(payload)).not.toThrow();
  });

  it('rejects when url is empty', () => {
    expect(() =>
      assetOriginalUrlResponseSchema.parse({ url: '', expiresAt: '2026-05-01T12:34:56.000Z' }),
    ).toThrow();
  });

  it('rejects when expiresAt is not an ISO datetime', () => {
    expect(() =>
      assetOriginalUrlResponseSchema.parse({ url: 'https://x', expiresAt: 'not-a-date' }),
    ).toThrow();
  });
});
