import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { APP_BOOTSTRAP_LISTENER, ApplicationRef, DOCUMENT, PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { APP_STABLE_ATTRIBUTE, provideAppStableMarker } from './app-stable-marker';

async function bootOn(platform: 'browser' | 'server'): Promise<HTMLElement> {
  TestBed.configureTestingModule({
    providers: [provideAppStableMarker(), { provide: PLATFORM_ID, useValue: platform }],
  });
  const listeners = TestBed.inject(APP_BOOTSTRAP_LISTENER);
  listeners.forEach((listener) => listener(undefined as never));
  await TestBed.inject(ApplicationRef).whenStable();
  await Promise.resolve();
  return TestBed.inject(DOCUMENT).documentElement;
}

describe('provideAppStableMarker', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    document.documentElement.removeAttribute(APP_STABLE_ATTRIBUTE);
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    document.documentElement.removeAttribute(APP_STABLE_ATTRIBUTE);
  });

  it('marks <html> once the browser app is stable', async () => {
    const html = await bootOn('browser');
    expect(html.hasAttribute(APP_STABLE_ATTRIBUTE)).toBe(true);
  });

  it('never marks the server render, so the SSR HTML cannot ship it', async () => {
    const html = await bootOn('server');
    expect(html.hasAttribute(APP_STABLE_ATTRIBUTE)).toBe(false);
  });
});
