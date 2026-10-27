import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { InspectUrlAdminDto } from './inspect-url-admin.dto';

describe('InspectUrlAdminDto', () => {
  const make = (obj: Record<string, unknown>) => plainToInstance(InspectUrlAdminDto, obj);

  it('accepts an absolute https url', async () => {
    const errors = await validate(make({ url: 'https://atlas.example/en/catalog/product/honey' }));
    expect(errors).toHaveLength(0);
  });

  it('accepts a no-TLD url (require_tld: false)', async () => {
    const errors = await validate(
      make({ url: 'http://localhost:53300/en/catalog/product/widget' }),
    );
    expect(errors).toHaveLength(0);
  });

  it('accepts a non-empty productId', async () => {
    const errors = await validate(make({ productId: 'cmprod000000000000000001' }));
    expect(errors).toHaveLength(0);
  });

  it.each(['fr', 'en'])('accepts locale %s', async (locale) => {
    const errors = await validate(make({ productId: 'p1', locale }));
    expect(errors).toHaveLength(0);
  });

  it('accepts all fields absent (cardinality is enforced in the service)', async () => {
    const errors = await validate(make({}));
    expect(errors).toHaveLength(0);
  });

  it('accepts both url and productId present (the 400 is thrown in the service)', async () => {
    const errors = await validate(
      make({ url: 'https://atlas.example/en/catalog/product/honey', productId: 'p1' }),
    );
    expect(errors).toHaveLength(0);
  });

  it('rejects a locale outside the engine catalogue', async () => {
    const errors = await validate(make({ productId: 'p1', locale: 'de' }));
    expect(errors[0]?.property).toBe('locale');
  });

  it('rejects a bogus locale', async () => {
    const errors = await validate(make({ productId: 'p1', locale: 'bogus' }));
    expect(errors[0]?.property).toBe('locale');
  });

  it('rejects a non-string productId', async () => {
    const errors = await validate(make({ productId: 42 }));
    expect(errors[0]?.property).toBe('productId');
  });

  it('rejects a non-url string in url', async () => {
    const errors = await validate(make({ url: 'not a url' }));
    expect(errors[0]?.property).toBe('url');
  });
});
