import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';

import type { ProductSpec } from '@storefront-types';

import { getChromeStrings } from '../../../i18n';
import { LocaleService } from '../../locale.service';
import { assertAxeClean, renderComponent } from '../../ui/testing';
import { ProductSpecsComponent } from './product-specs.component';

// Windows checkouts carry CRLF, so normalise before any source assertion.
const SOURCE = readFileSync(join(__dirname, 'product-specs.component.ts'), 'utf8').replace(
  /\r\n/g,
  '\n',
);

function spec(n: number, label: string, value: string): ProductSpec {
  return {
    id: `s${n}`,
    label: { default: label, fr: label, en: label },
    value: { default: value, fr: value, en: value },
    key: label.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    sortOrder: n,
  } as unknown as ProductSpec;
}

/** 15 rows is the real shape: the catalogue's median is 12 and its mode 16. */
const MANY: ProductSpec[] = Array.from({ length: 15 }, (_, i) =>
  spec(i, `Libellé ${i}`, `Valeur ${i}`),
);

const FEW: ProductSpec[] = [
  spec(0, "Pression d'air", '0,30 à 0,35 MPa'),
  spec(1, 'Type de mandrin', 'Bouton-poussoir'),
];

async function render(specs: ProductSpec[]) {
  return renderComponent(ProductSpecsComponent, { specs, idSuffix: 'p1' }, [LocaleService]);
}

describe('ProductSpecsComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => TestBed.resetTestingModule());

  it('renders one row per specification', async () => {
    const fixture = await render(FEW);
    const rows = fixture.nativeElement.querySelectorAll('[data-testid="product-spec-row"]');
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector('th')?.textContent?.trim()).toBe("Pression d'air");
    expect(rows[0].querySelector('td')?.textContent?.trim()).toBe('0,30 à 0,35 MPa');
  });

  it('renders nothing at all when the product carries no specification', async () => {
    // 17 of the 94 seeded products have zero spec rows, so the empty branch is
    // load-bearing rather than defensive.
    const fixture = await render([]);
    expect(fixture.nativeElement.querySelector('[data-testid="product-specs"]')).toBeNull();
  });

  it('drops a row that lost one half of its pair', async () => {
    const fixture = await render([spec(0, 'Garantie', ''), spec(1, 'Matériau', 'Métal')]);
    const rows = fixture.nativeElement.querySelectorAll('[data-testid="product-spec-row"]');
    expect(rows).toHaveLength(1);
  });

  describe('semantics', () => {
    it('is a real table with a row header per row, not a grid of divs', async () => {
      // This is what makes a screen reader announce "Pression d'air, 0,30 MPa"
      // as one fact instead of two unrelated strings.
      const fixture = await render(FEW);
      const table = fixture.nativeElement.querySelector('table');
      expect(table).not.toBeNull();
      const th = table.querySelector('th');
      expect(th?.getAttribute('scope')).toBe('row');
      expect(table.querySelector('caption')).not.toBeNull();
    });

    it('labels the section by its heading', async () => {
      const fixture = await render(FEW);
      const section = fixture.nativeElement.querySelector('[data-testid="product-specs"]');
      const labelledBy = section?.getAttribute('aria-labelledby');
      expect(labelledBy).toBeTruthy();
      expect(fixture.nativeElement.querySelector(`#${labelledBy}`)?.textContent?.trim()).toBe(
        getChromeStrings('fr').product.specs.title,
      );
    });

    it('scopes its DOM ids by suffix so two instances cannot collide', async () => {
      const fixture = await render(FEW);
      const section = fixture.nativeElement.querySelector('[data-testid="product-specs"]');
      expect(section?.getAttribute('aria-labelledby')).toContain('p1');
    });

    it('has no axe violation', async () => {
      const fixture = await render(MANY);
      await assertAxeClean(fixture.nativeElement);
    });
  });

  describe('collapse', () => {
    it('offers no toggle when the table is short', async () => {
      const fixture = await render(FEW);
      expect(
        fixture.nativeElement.querySelector('[data-testid="product-specs-toggle"]'),
      ).toBeNull();
    });

    it('keeps every row in the DOM when collapsed, hiding overflow by class', async () => {
      // The rows must be in the SSR first byte for a crawler and for Ctrl+F, so
      // this asserts the count is FULL while the table is collapsed. Rendering
      // only the first eight would pass a naive "is it collapsed" check and
      // silently cost the content.
      const fixture = await render(MANY);
      expect(
        fixture.nativeElement.querySelectorAll('[data-testid="product-spec-row"]'),
      ).toHaveLength(15);
      expect(fixture.nativeElement.querySelector('table')?.classList).toContain('collapsed');
      expect(fixture.nativeElement.querySelectorAll('.beyond-fold')).toHaveLength(7);
    });

    it('announces its state and expands on click', async () => {
      const fixture = await render(MANY);
      const toggle = fixture.nativeElement.querySelector(
        '[data-testid="product-specs-toggle"]',
      ) as HTMLButtonElement;
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(toggle.textContent?.trim()).toBe(
        getChromeStrings('fr').product.specs.showAll.replace('{count}', '15'),
      );

      toggle.click();
      fixture.detectChanges();

      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(fixture.nativeElement.querySelector('table')?.classList).not.toContain('collapsed');
      expect(toggle.textContent?.trim()).toBe(getChromeStrings('fr').product.specs.showLess);
    });
  });

  describe('brand floor', () => {
    it('puts tabular figures on the value column (§3.2)', async () => {
      // A spec column is the densest stack of numbers on the page, and §3.2
      // makes tabular-nums mandatory wherever numbers stack.
      expect(SOURCE).toMatch(/\.value\s*\{[^}]*font-variant-numeric:\s*tabular-nums/);
    });

    it('lets a wide value scroll inside its own box, never the page', async () => {
      expect(SOURCE).toMatch(/\.scroller\s*\{[^}]*overflow-x:\s*auto/);
      const fixture = await render(FEW);
      expect(fixture.nativeElement.querySelector('.scroller')).not.toBeNull();
    });

    it('consumes brand tokens and never a raw hex', async () => {
      const styles = SOURCE.slice(SOURCE.indexOf('styles: ['));
      expect(styles).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(styles).toContain('var(--brand-');
    });

    it('uses logical properties, not physical ones (§7.4)', async () => {
      const styles = SOURCE.slice(SOURCE.indexOf('styles: ['));
      expect(styles).not.toMatch(/[^-]\b(margin|padding)-(left|right)\b/);
      expect(styles).not.toMatch(/\bwidth:\s/);
    });
  });
});
