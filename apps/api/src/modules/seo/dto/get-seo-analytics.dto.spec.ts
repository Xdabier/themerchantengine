import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GetSeoAnalyticsAdminDto } from './get-seo-analytics.dto';

describe('GetSeoAnalyticsAdminDto', () => {
  const make = (obj: Record<string, unknown>) => plainToInstance(GetSeoAnalyticsAdminDto, obj);

  it.each(['7d', '28d', '90d'])('accepts range %s', async (range) => {
    const errors = await validate(make({ range }));
    expect(errors).toHaveLength(0);
  });

  it('accepts an absent range (field is @IsOptional)', async () => {
    const errors = await validate(make({}));
    expect(errors).toHaveLength(0);
  });

  it('rejects an out-of-allowlist range', async () => {
    const errors = await validate(make({ range: 'bogus' }));
    expect(errors[0]?.property).toBe('range');
  });

  it('rejects a 1d range (not in the allowlist)', async () => {
    const errors = await validate(make({ range: '1d' }));
    expect(errors[0]?.property).toBe('range');
  });

  it('rejects a numeric range (wrong type)', async () => {
    const errors = await validate(make({ range: 30 }));
    expect(errors[0]?.property).toBe('range');
  });
});
