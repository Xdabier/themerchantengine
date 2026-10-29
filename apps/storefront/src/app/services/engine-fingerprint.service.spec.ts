import { DOCUMENT } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import { EngineFingerprintService } from './engine-fingerprint.service';

/**
 * The template is read from disk, so removing a marker from `index.html` turns
 * these red, not only a change to the service.
 */
const TEMPLATE = readFileSync(resolve(__dirname, '../../../index.html'), 'utf8');

function build(platform: 'server' | 'browser') {
  TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: platform }] });
  const document = TestBed.inject(DOCUMENT);
  document.querySelector('meta[name="generator"]')?.remove();
  const meta = document.createElement('meta');
  meta.setAttribute('name', 'generator');
  meta.setAttribute('content', 'themerchantengine');
  document.head.appendChild(meta);
  document.documentElement.setAttribute('data-tme-app', 'storefront');
  return { service: TestBed.inject(EngineFingerprintService), document };
}

const generator = (document: Document) =>
  document.querySelector('meta[name="generator"]')?.getAttribute('content') ?? null;

describe('storefront index.html markers', () => {
  it('ships the generator meta and the app attribute', () => {
    expect(TEMPLATE).toContain('<meta name="generator" content="themerchantengine" />');
    expect(TEMPLATE).toMatch(/<html[^>]* data-tme-app="storefront"/);
  });
});

describe('EngineFingerprintService', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('keeps the name only by default', () => {
    const { service, document } = build('server');
    service.apply({});
    expect(generator(document)).toBe('themerchantengine');
    expect(document.documentElement.getAttribute('data-tme-app')).toBe('storefront');
  });

  it('adds the major version when asked', () => {
    const { service, document } = build('server');
    service.apply({ TME_FINGERPRINT_VERSION: 'major' });
    expect(generator(document)).toBe('themerchantengine 1');
  });

  it('removes every marker when TME_FINGERPRINT=off', () => {
    const { service, document } = build('server');
    service.apply({ TME_FINGERPRINT: 'off' });
    expect(generator(document)).toBeNull();
    expect(document.documentElement.hasAttribute('data-tme-app')).toBe(false);
  });

  it('does nothing on the browser pass', () => {
    const { service, document } = build('browser');
    service.apply({ TME_FINGERPRINT: 'off' });
    expect(generator(document)).toBe('themerchantengine');
  });
});
