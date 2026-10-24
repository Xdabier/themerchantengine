import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateRedirectAdminDto } from './create-redirect.dto';

async function validateDto(payload: Record<string, unknown>) {
  const dto = plainToInstance(CreateRedirectAdminDto, payload);
  return validate(dto);
}

describe('CreateRedirectAdminDto', () => {
  it('accepts valid root-relative paths', async () => {
    const errors = await validateDto({ fromPath: '/old', toPath: '/new' });
    expect(errors).toHaveLength(0);
  });

  it('rejects protocol-relative toPath (//evil.com)', async () => {
    const errors = await validateDto({ fromPath: '/old', toPath: '//evil.com' });
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('toPath');
    expect(errors[0].constraints?.matches).toMatch(/must start with/);
  });

  it('rejects backslash-prefixed toPath (/\\evil.com)', async () => {
    const errors = await validateDto({ fromPath: '/old', toPath: '/\\evil.com' });
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('toPath');
  });

  it('rejects bare hostname toPath (evil.com)', async () => {
    const errors = await validateDto({ fromPath: '/old', toPath: 'evil.com' });
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('toPath');
  });

  it('rejects protocol-relative fromPath', async () => {
    const errors = await validateDto({ fromPath: '//evil.com', toPath: '/new' });
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors.find((e) => e.property === 'fromPath')).toBeDefined();
  });

  it('accepts type when provided', async () => {
    const errors = await validateDto({
      fromPath: '/old',
      toPath: '/new',
      type: 'FOUND',
    });
    expect(errors).toHaveLength(0);
  });
});
