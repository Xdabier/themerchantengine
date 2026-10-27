import { humanizeCode, labelFromMap } from './enum-label';

describe('humanizeCode', () => {
  it('title-cases SCREAMING_SNAKE codes', () => {
    expect(humanizeCode('OUT_OF_STOCK')).toBe('Out Of Stock');
  });

  it('title-cases snake_case codes', () => {
    expect(humanizeCode('product_view')).toBe('Product View');
  });

  it('title-cases kebab-case codes', () => {
    expect(humanizeCode('newsletter-footer')).toBe('Newsletter Footer');
  });

  it('title-cases dotted codes', () => {
    expect(humanizeCode('product.update')).toBe('Product Update');
  });

  it('returns the fallback for nullish / empty input', () => {
    expect(humanizeCode(null)).toBe('—');
    expect(humanizeCode('')).toBe('—');
    expect(humanizeCode(undefined, 'n/a')).toBe('n/a');
  });
});

describe('labelFromMap', () => {
  const map = { DRAFT: 'Draft', SENT: 'Sent' } as const;

  it('returns the mapped label when present', () => {
    expect(labelFromMap(map, 'DRAFT')).toBe('Draft');
  });

  it('humanizes codes the map does not cover', () => {
    expect(labelFromMap(map, 'ENQUEUE_FAILED' as keyof typeof map)).toBe('Enqueue Failed');
  });

  it('returns the fallback for nullish input', () => {
    expect(labelFromMap(map, null)).toBe('—');
  });
});
