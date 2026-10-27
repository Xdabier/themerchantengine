import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SubmitSeoAdminDto } from './submit-seo.dto';

async function validateDto(payload: Record<string, unknown>) {
  const dto = plainToInstance(SubmitSeoAdminDto, payload);
  return validate(dto);
}

// Product IDs in this system are CUIDs, not UUID v4.
const VALID_CUID = 'cmqxf50vo00grkwqsv7xjt9zt';

describe('SubmitSeoAdminDto', () => {
  it('accepts a single url target', async () => {
    const errors = await validateDto({ url: 'https://atlas.example/en/catalog/product/widget' });
    expect(errors).toHaveLength(0);
  });

  it('accepts a productIds target with CUID ids (CUIDs are the id format for products)', async () => {
    const errors = await validateDto({ productIds: [VALID_CUID] });
    expect(errors).toHaveLength(0);
  });

  it('accepts a sitemap target of literal true', async () => {
    const errors = await validateDto({ sitemap: true });
    expect(errors).toHaveLength(0);
  });

  it('accepts optional engines + dryRun alongside a target', async () => {
    const errors = await validateDto({ sitemap: true, engines: ['gsc', 'bing'], dryRun: true });
    expect(errors).toHaveLength(0);
  });

  it('rejects a non-absolute url', async () => {
    const errors = await validateDto({ url: 'not-a-url' });
    expect(errors.find((e) => e.property === 'url')).toBeDefined();
  });

  it('accepts any non-empty string productId (including plain slugs or legacy IDs)', async () => {
    const errors = await validateDto({ productIds: ['not-a-uuid', VALID_CUID] });
    expect(errors.find((e) => e.property === 'productIds')).toBeUndefined();
  });

  it('rejects an empty productIds array', async () => {
    const errors = await validateDto({ productIds: [] });
    expect(errors.find((e) => e.property === 'productIds')).toBeDefined();
  });

  it('rejects sitemap: false (must be literal true)', async () => {
    const errors = await validateDto({ sitemap: false });
    expect(errors.find((e) => e.property === 'sitemap')).toBeDefined();
  });

  it('rejects an unknown engine value', async () => {
    const errors = await validateDto({ sitemap: true, engines: ['yandex'] });
    expect(errors.find((e) => e.property === 'engines')).toBeDefined();
  });

  it('rejects a non-boolean dryRun', async () => {
    const errors = await validateDto({ sitemap: true, dryRun: 'yes' });
    expect(errors.find((e) => e.property === 'dryRun')).toBeDefined();
  });

  it('rejects productIds exceeding the 500-item cap', async () => {
    const tooMany = Array.from({ length: 501 }, () => VALID_CUID);
    const errors = await validateDto({ productIds: tooMany });
    expect(errors.find((e) => e.property === 'productIds')).toBeDefined();
  });

  it('rejects an empty engines array', async () => {
    const errors = await validateDto({ sitemap: true, engines: [] });
    expect(errors.find((e) => e.property === 'engines')).toBeDefined();
  });

  // Note: the "exactly one target" cardinality (zero or multiple targets) is
  // enforced in SeoSubmitOrchestrator, not at the DTO layer — see that spec.
});
