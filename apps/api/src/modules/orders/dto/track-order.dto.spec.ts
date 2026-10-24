import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TrackOrderDto } from './query-orders.dto';

/**
 * `TrackOrderDto` moved from a query string to a request body at plan M phase
 * M3 (finding K10). The order number is now part of it, so it needs the same
 * validation the email always had: a public endpoint takes both halves of the
 * challenge from an untrusted caller.
 */
describe('TrackOrderDto', () => {
  async function errorsFor(payload: Record<string, unknown>): Promise<string[]> {
    const dto = plainToInstance(TrackOrderDto, payload);
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    return errors.map((e) => e.property);
  }

  it('accepts a real order number and email pair', async () => {
    await expect(
      errorsFor({ orderNumber: 'ORD-2026-000005', email: 'buyer@example.test' }),
    ).resolves.toEqual([]);
  });

  it('requires an order number', async () => {
    await expect(errorsFor({ email: 'buyer@example.test' })).resolves.toContain('orderNumber');
  });

  it('requires an email', async () => {
    await expect(errorsFor({ orderNumber: 'ORD-2026-000005' })).resolves.toContain('email');
  });

  it('refuses an order number carrying anything but uppercase, digits and dashes', async () => {
    for (const bad of ['ord-2026-000005', 'ORD 2026 000005', "ORD'--", 'ORD-2026-000005;--']) {
      await expect(errorsFor({ orderNumber: bad, email: 'buyer@example.test' })).resolves.toContain(
        'orderNumber',
      );
    }
  });

  it('refuses an over-long order number', async () => {
    await expect(
      errorsFor({ orderNumber: 'O'.repeat(33), email: 'buyer@example.test' }),
    ).resolves.toContain('orderNumber');
  });

  it('refuses an over-long email', async () => {
    await expect(
      errorsFor({ orderNumber: 'ORD-2026-000005', email: `${'a'.repeat(250)}@example.test` }),
    ).resolves.toContain('email');
  });
});
