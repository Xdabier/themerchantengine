import { describe, expect, it } from 'vitest';
import { llmsPayloadSchema, robotsPayloadSchema, sitemapPayloadSchema } from './seo.schemas';

describe('sitemapPayloadSchema', () => {
  it('parses a valid sitemap payload', () => {
    expect(() =>
      sitemapPayloadSchema.parse({
        contentType: 'application/xml; charset=utf-8',
        body: '<?xml version="1.0"?><urlset></urlset>',
      }),
    ).not.toThrow();
  });

  it('rejects empty body', () => {
    expect(() =>
      sitemapPayloadSchema.parse({ contentType: 'application/xml; charset=utf-8', body: '' }),
    ).toThrow();
  });
});

describe('robotsPayloadSchema', () => {
  it('parses a valid robots payload', () => {
    expect(() =>
      robotsPayloadSchema.parse({
        contentType: 'text/plain; charset=utf-8',
        body: 'User-agent: *\nAllow: /\n',
      }),
    ).not.toThrow();
  });

  it('rejects an unexpected content-type', () => {
    expect(() =>
      robotsPayloadSchema.parse({
        contentType: 'text/html',
        body: 'User-agent: *',
      }),
    ).toThrow();
  });
});

describe('llmsPayloadSchema', () => {
  it('parses a valid llms.txt payload', () => {
    expect(() =>
      llmsPayloadSchema.parse({
        contentType: 'text/plain; charset=utf-8',
        body: '# Probe Store\nWelcome.',
      }),
    ).not.toThrow();
  });
});
