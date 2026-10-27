import { describe, expect, it } from 'vitest';

import {
  cmsPageListResponseSchema,
  cmsPageResponseSchema,
  cmsPageSchema,
  cmsPageTypeSchema,
  type CmsPage,
} from './cms.schemas';

describe('cmsPageTypeSchema', () => {
  it('accepts each canonical enum member', () => {
    expect(() => cmsPageTypeSchema.parse('STATIC')).not.toThrow();
    expect(() => cmsPageTypeSchema.parse('POLICY')).not.toThrow();
    expect(() => cmsPageTypeSchema.parse('LANDING')).not.toThrow();
  });

  it('rejects an unknown enum member', () => {
    expect(() => cmsPageTypeSchema.parse('BLOG')).toThrow();
    expect(() => cmsPageTypeSchema.parse('static')).toThrow();
    expect(() => cmsPageTypeSchema.parse('')).toThrow();
  });
});

describe('cmsPageSchema', () => {
  function buildValid(overrides: Partial<CmsPage> = {}): CmsPage {
    return {
      id: 'cms-page-1',
      slug: '/about',
      type: 'STATIC',
      title: 'About Probe Store',
      content: '<p>Founded in Lyon.</p>',
      ...overrides,
    } as CmsPage;
  }

  it('parses a minimum-required CMS page payload', () => {
    expect(() => cmsPageSchema.parse(buildValid())).not.toThrow();
  });

  it('parses a fully-populated CMS page payload', () => {
    expect(() =>
      cmsPageSchema.parse(
        buildValid({
          metaTitle: 'About | Probe Store',
          metaDescription: 'The Probe Store story.',
          isPublished: true,
          sortOrder: 5,
          showInNavigation: true,
          template: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-05-04T12:00:00.000Z',
        }),
      ),
    ).not.toThrow();
  });

  it('accepts null for optional metaTitle / metaDescription / template', () => {
    expect(() =>
      cmsPageSchema.parse(buildValid({ metaTitle: null, metaDescription: null, template: null })),
    ).not.toThrow();
  });

  it('rejects payloads missing a required field', () => {
    const omitKey = (key: keyof CmsPage): Partial<CmsPage> => {
      const copy = { ...buildValid() } as Partial<CmsPage>;
      delete copy[key];
      return copy;
    };
    expect(() => cmsPageSchema.parse(omitKey('id'))).toThrow();
    expect(() => cmsPageSchema.parse(omitKey('slug'))).toThrow();
    expect(() => cmsPageSchema.parse(omitKey('type'))).toThrow();
    expect(() => cmsPageSchema.parse(omitKey('title'))).toThrow();
    expect(() => cmsPageSchema.parse(omitKey('content'))).toThrow();
  });

  it('rejects an unknown enum on type', () => {
    expect(() => cmsPageSchema.parse(buildValid({ type: 'BLOG' as never }))).toThrow();
  });

  it('rejects an empty-string id or slug', () => {
    expect(() => cmsPageSchema.parse(buildValid({ id: '' }))).toThrow();
    expect(() => cmsPageSchema.parse(buildValid({ slug: '' }))).toThrow();
  });
});

describe('cmsPageResponseSchema', () => {
  it('wraps the CMS page in the API envelope', () => {
    expect(() =>
      cmsPageResponseSchema.parse({
        data: {
          id: 'cms-page-1',
          slug: '/privacy-policy',
          type: 'POLICY',
          title: 'Privacy Policy',
          content: '<p>We respect your privacy.</p>',
        },
      }),
    ).not.toThrow();
  });

  it('rejects a payload missing the data envelope', () => {
    expect(() =>
      cmsPageResponseSchema.parse({
        id: 'cms-page-1',
        slug: '/about',
        type: 'STATIC',
        title: 'About',
        content: 'x',
      }),
    ).toThrow();
  });
});

describe('cmsPageListResponseSchema', () => {
  const row = {
    id: 'cms-page-1',
    slug: '/faq',
    type: 'STATIC' as const,
    title: 'FAQ',
    content: '<p>Answers.</p>',
    sortOrder: 6,
    showInNavigation: true,
    isPublished: true,
  };

  it('parses the array envelope GET /v1/pages returns', () => {
    const parsed = cmsPageListResponseSchema.parse({ data: [row] });
    expect(parsed.data).toHaveLength(1);
    expect(parsed.data[0].slug).toBe('/faq');
    expect(parsed.data[0].showInNavigation).toBe(true);
  });

  it('parses an empty catalogue of pages', () => {
    expect(cmsPageListResponseSchema.parse({ data: [] }).data).toEqual([]);
  });

  it('rejects a single page sent where the array is expected', () => {
    expect(() => cmsPageListResponseSchema.parse({ data: row })).toThrow();
  });

  it('rejects a row missing a required field', () => {
    expect(() =>
      cmsPageListResponseSchema.parse({ data: [{ ...row, title: undefined }] }),
    ).toThrow();
  });
});
