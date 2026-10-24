import { ChangeDetectionStrategy, Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import axe from 'axe-core';
import { expect } from 'vitest';

import { provideFixtureStoreConfig } from '../../test-support/store-config-fixtures';

/**
 * Renders a standalone component under the test bed with OnPush flipped to
 * Default so signal updates inside `it()` reflect without explicit
 * `fixture.detectChanges()` ceremony. Mirrors the splash page spec helper at
 * `apps/storefront/src/app/pages/[locale]/index.page.spec.ts:25`.
 */
export async function renderComponent<T>(
  component: Type<T>,
  inputs: Partial<Record<keyof T, unknown>> = {},
  providers: unknown[] = [],
): Promise<ComponentFixture<T>> {
  TestBed.overrideComponent(component, {
    set: { changeDetection: ChangeDetectionStrategy.Default },
  });
  // Every component spec renders under a scenario fixture rather than the
  // neutral config a fresh install boots on. `maghreb-ltr` is the default
  // because it is the three-decimal one, and a money rule that only breaks at
  // three decimals would pass untested under a two-decimal store. A spec that
  // asserts a scenario difference passes its own provider, which wins.
  TestBed.configureTestingModule({
    providers: [provideFixtureStoreConfig('maghreb-ltr'), ...providers] as never,
  });
  const fixture = TestBed.createComponent(component);
  for (const [key, value] of Object.entries(inputs)) {
    fixture.componentRef.setInput(key, value);
  }
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture;
}

export interface AxeRunOptions {
  /** Skip axe rules that produce noise on isolated components. */
  disabledRules?: string[];
}

/**
 * Asserts the host element has zero serious / critical axe violations under
 * WCAG 2.2 AA. Mirrors the splash page spec assertion at
 * `apps/storefront/src/app/pages/[locale]/index.page.spec.ts:71-79`.
 */
export async function assertAxeClean(host: HTMLElement, opts: AxeRunOptions = {}): Promise<void> {
  const result = await axe.run(host, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] },
    rules: Object.fromEntries((opts.disabledRules ?? []).map((id) => [id, { enabled: false }])),
  });
  const blocking = result.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
}

/**
 * Attaches the host element to the document inside a temporary wrapper.
 *
 * axe-core only reports reliably on nodes that are in the document, so every
 * `assertAxeClean` call needs its fixture attached first. Replaces the former
 * `withDirection(host, dir)` helper: the default locale pair is left-to-right,
 * so the `dir` parameter had no state left to exercise (brand floor §7.4).
 */
export function attachToBody(host: HTMLElement): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.appendChild(host);
  document.body.appendChild(wrapper);
  return wrapper;
}
