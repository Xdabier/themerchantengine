import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { getChromeStrings } from '../../../i18n';
import { LocaleService } from '../../locale.service';
import { WishlistStateService } from '../../services/wishlist-state.service';
import { ToastService } from '../../ui/toast.component';
import { assertAxeClean, attachToBody, renderComponent } from '../../ui/testing';
import {
  ProductSummaryComponent,
  type AddToCartRequest,
  type ProductSummaryInput,
  type ProductVariantOption,
} from './product-summary.component';

// core.autocrlf is true on Windows checkouts, so the file on disk can carry
// CRLF. Normalise before matching, or every substring assertion below is
// green on one platform and red on the other.
const SOURCE = readFileSync(join(__dirname, 'product-summary.component.ts'), 'utf8').replace(
  /\r\n/g,
  '\n',
);

const baseInput: ProductSummaryInput = {
  title: 'Echo Buds Pro',
  description: 'Wireless earbuds with active noise cancellation.',
  brand: 'Echo',
  variants: [
    {
      id: 'v1',
      label: 'Black',
      price: 449,
      inStock: true,
      availability: 'IN_STOCK',
      sku: 'ECH-BUD-BLK',
    },
  ],
  currency: 'AED',
  ratingValue: 4.6,
  reviewCount: 23,
};

describe('ProductSummaryComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => TestBed.resetTestingModule());

  it('renders title, brand, price, stock, delivery, add-to-cart', async () => {
    const fixture = await renderComponent(ProductSummaryComponent, { input: baseInput }, [
      provideRouter([]),
      LocaleService,
    ]);
    expect(fixture.nativeElement.querySelector('.title')?.textContent).toContain('Echo Buds Pro');
    expect(fixture.nativeElement.querySelector('.brand')?.textContent?.trim()).toBe('Echo');
    expect(fixture.nativeElement.querySelector('app-price')).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('.delivery')?.textContent?.trim().length,
    ).toBeGreaterThan(0);
    expect(
      fixture.nativeElement.querySelector('[data-testid="product-add-to-cart"]'),
    ).not.toBeNull();
  });

  it('hides rating when reviewCount is 0 (no fake stars)', async () => {
    const fixture = await renderComponent(
      ProductSummaryComponent,
      { input: { ...baseInput, reviewCount: 0, ratingValue: 4.5 } },
      [provideRouter([]), LocaleService],
    );
    expect(fixture.nativeElement.querySelector('app-rating')).toBeNull();
  });

  it('hides the variant selector when only one variant exists', async () => {
    const fixture = await renderComponent(ProductSummaryComponent, { input: baseInput }, [
      provideRouter([]),
      LocaleService,
    ]);
    expect(fixture.nativeElement.querySelector('fieldset.variants')).toBeNull();
  });

  it('renders variant buttons when more than one variant exists', async () => {
    const variants: ProductVariantOption[] = [
      { id: 'v1', label: 'Black', price: 449, inStock: true, availability: 'IN_STOCK', sku: 'A-1' },
      {
        id: 'v2',
        label: 'White',
        price: 449,
        inStock: true,
        availability: 'LOW_STOCK',
        sku: 'A-2',
      },
      {
        id: 'v3',
        label: 'Sand',
        price: 449,
        inStock: false,
        availability: 'OUT_OF_STOCK',
        sku: 'A-3',
      },
    ];
    const fixture = await renderComponent(
      ProductSummaryComponent,
      { input: { ...baseInput, variants } },
      [provideRouter([]), LocaleService],
    );
    const buttons = fixture.nativeElement.querySelectorAll('.variant');
    expect(buttons.length).toBe(3);
    expect((buttons[2] as HTMLButtonElement).disabled).toBe(true);
    expect(buttons[0].getAttribute('aria-pressed')).toBeDefined();
  });

  it('emits addToCart when the button is clicked', async () => {
    const fixture = await renderComponent(ProductSummaryComponent, { input: baseInput }, [
      provideRouter([]),
      LocaleService,
    ]);
    let received: AddToCartRequest | null = null;
    fixture.componentInstance.addToCart.subscribe((r: AddToCartRequest) => {
      received = r;
    });
    const btn = fixture.nativeElement.querySelector(
      '[data-testid="product-add-to-cart"]',
    ) as HTMLButtonElement;
    btn.click();
    expect(received).not.toBeNull();
    expect(received).toMatchObject({ variant: { id: 'v1' }, quantity: 1 });
  });

  it('disables the add-to-cart button while addState is submitting', async () => {
    const fixture = await renderComponent(
      ProductSummaryComponent,
      { input: baseInput, addState: 'submitting' },
      [provideRouter([]), LocaleService],
    );
    const btn = fixture.nativeElement.querySelector(
      '[data-testid="product-add-to-cart"]',
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-busy')).toBe('true');
  });

  it('renders the error alert when addState is error', async () => {
    const fixture = await renderComponent(
      ProductSummaryComponent,
      { input: baseInput, addState: 'error' },
      [provideRouter([]), LocaleService],
    );
    const err = fixture.nativeElement.querySelector('[data-testid="product-add-to-cart-error"]');
    expect(err).not.toBeNull();
    expect(err?.getAttribute('role')).toBe('alert');
  });

  it('disables the add-to-cart button when the active variant is out of stock', async () => {
    const fixture = await renderComponent(
      ProductSummaryComponent,
      {
        input: {
          ...baseInput,
          variants: [
            {
              id: 'v1',
              label: 'Black',
              price: 449,
              inStock: false,
              availability: 'OUT_OF_STOCK',
              sku: 'ECH-BUD-BLK',
            },
          ],
        },
      },
      [provideRouter([]), LocaleService],
    );
    const btn = fixture.nativeElement.querySelector(
      '[data-testid="product-add-to-cart"]',
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('passes axe with required form labels', async () => {
    const fixture = await renderComponent(ProductSummaryComponent, { input: baseInput }, [
      provideRouter([]),
      LocaleService,
    ]);
    await assertAxeClean(fixture.nativeElement);
  });

  describe('rich-text description', () => {
    // The admin authors this with TranslatableRichTextComponent, so the value is
    // HTML. It used to be interpolated, which escaped it and showed the customer
    // a literal "<p>...</p>". Every assertion below is the POSITIVE form: revert
    // the template to {{ }} and each one goes red, which is the only way to know
    // the guard can fail.
    const RICH =
      '<p>Contre-angle <strong>1:1</strong></p><ul><li>Irrigation interne</li><li>Bouton-poussoir</li></ul>';

    async function renderRich() {
      return renderComponent(
        ProductSummaryComponent,
        { input: { ...baseInput, description: RICH } },
        [provideRouter([]), LocaleService],
      );
    }

    it('renders the markup as real elements, not as escaped text', async () => {
      const fixture = await renderRich();
      const host = fixture.nativeElement.querySelector('[data-testid="product-description"]');
      expect(host).not.toBeNull();
      expect(host.querySelectorAll('li')).toHaveLength(2);
      expect(host.querySelector('strong')?.textContent).toBe('1:1');
      expect(host.querySelector('li')?.textContent).toBe('Irrigation interne');
      // The escaped form is what the bug produced. It must not survive anywhere.
      expect(host.textContent).not.toContain('<p>');
      expect(host.textContent).not.toContain('<li>');
    });

    it('hosts the description in a DIV, because a P cannot legally contain a UL', async () => {
      // A <p> wrapper makes the parser auto-close and re-parent the list, so the
      // SSR bytes and the hydrated DOM disagree and Angular reports a hydration
      // mismatch. This asserts the element, not the appearance.
      const fixture = await renderRich();
      const host = fixture.nativeElement.querySelector('[data-testid="product-description"]');
      expect(host.tagName).toBe('DIV');
    });

    it('still renders plain-text descriptions unchanged', async () => {
      const fixture = await renderComponent(
        ProductSummaryComponent,
        { input: { ...baseInput, description: 'Texte simple, sans balise.' } },
        [provideRouter([]), LocaleService],
      );
      const host = fixture.nativeElement.querySelector('[data-testid="product-description"]');
      expect(host?.textContent?.trim()).toBe('Texte simple, sans balise.');
    });

    it('drops a script tag through the runtime sanitiser', async () => {
      // Two write-side gates already scrub this, so reaching the template is not
      // expected. Angular's default sanitiser is the last one, and asserting it
      // is what stops a future refactor reaching for bypassSecurityTrustHtml.
      const fixture = await renderComponent(
        ProductSummaryComponent,
        { input: { ...baseInput, description: '<p>ok</p><script>alert(1)</script>' } },
        [provideRouter([]), LocaleService],
      );
      const host = fixture.nativeElement.querySelector('[data-testid="product-description"]');
      expect(host.querySelector('script')).toBeNull();
      expect(host.querySelector('p')?.textContent).toBe('ok');
    });

    it('keeps the paragraph breaks of a legacy plain-text description', async () => {
      // The whole seeded catalogue predates the editor and carries \n breaks.
      // Sent through [innerHTML] they collapse into one dense blob, so the
      // plain branch renders them with pre-wrap instead. Positive form: assert
      // the branch is taken AND that the breaks survive.
      const fixture = await renderComponent(
        ProductSummaryComponent,
        { input: { ...baseInput, description: 'Ligne une.\n\nLigne deux.' } },
        [provideRouter([]), LocaleService],
      );
      const host = fixture.nativeElement.querySelector('[data-testid="product-description"]');
      expect(host.classList.contains('description-plain')).toBe(true);
      expect(host.textContent).toContain('Ligne une.\n\nLigne deux.');
    });

    it('does not put a rich description on the plain branch', async () => {
      const fixture = await renderRich();
      const host = fixture.nativeElement.querySelector('[data-testid="product-description"]');
      expect(host.classList.contains('description-plain')).toBe(false);
    });

    it('gives the plain branch its pre-wrap rule in the source', async () => {
      // jsdom does not resolve the component stylesheet, so the computed style
      // is asserted by the storefront journey. This pins the rule itself.
      expect(SOURCE).toMatch(/\.description-plain\s*\{[^}]*white-space:\s*pre-wrap/);
    });

    it('binds through innerHTML in the source, never interpolation', async () => {
      // Source-level guard: a future edit that swaps the binding back to {{ }}
      // would still pass a DOM assertion on a plain-text fixture.
      expect(SOURCE).toContain('[innerHTML]="input().description"');
      expect(SOURCE).not.toContain('{{ input().description }}');
    });
  });

  describe('short description subtitle', () => {
    // Authored in the admin, validated, sanitized, delivered on the product
    // wire, and rendered by nobody. A field the operator fills in and never
    // sees is the same dead knob as a setting that saves nothing.
    it('renders the short description under the title', async () => {
      const fixture = await renderComponent(
        ProductSummaryComponent,
        { input: { ...baseInput, shortDescription: 'Contre-angle bague rouge, 1:1.' } },
        [provideRouter([]), LocaleService],
      );
      const subtitle = fixture.nativeElement.querySelector(
        '[data-testid="product-short-description"]',
      );
      expect(subtitle).not.toBeNull();
      expect(subtitle.textContent).toContain('Contre-angle bague rouge, 1:1.');
    });

    it('renders no subtitle element when the field is empty', async () => {
      const fixture = await renderComponent(ProductSummaryComponent, { input: baseInput }, [
        provideRouter([]),
        LocaleService,
      ]);
      expect(
        fixture.nativeElement.querySelector('[data-testid="product-short-description"]'),
      ).toBeNull();
    });

    it('renders an authored short description as markup, not as escaped text', async () => {
      // Sanitized on the same path as the description, so it can carry markup
      // even though it is normally authored plain.
      const fixture = await renderComponent(
        ProductSummaryComponent,
        { input: { ...baseInput, shortDescription: '<p>Bague <strong>rouge</strong></p>' } },
        [provideRouter([]), LocaleService],
      );
      const subtitle = fixture.nativeElement.querySelector(
        '[data-testid="product-short-description"]',
      );
      expect(subtitle.querySelector('strong')?.textContent).toBe('rouge');
      expect(subtitle.textContent).not.toContain('<p>');
    });
  });

  describe('availability (agent_docs/storefront/brand-tokens.md, §10 row 21)', () => {
    const stock = getChromeStrings('fr').product.stock;

    async function renderWith(
      availability: ProductVariantOption['availability'],
      inStock: boolean,
    ) {
      return renderComponent(
        ProductSummaryComponent,
        {
          input: {
            ...baseInput,
            variants: [
              { id: 'v1', label: 'Black', price: 449, inStock, availability, sku: 'ECH-BUD-BLK' },
            ],
          },
        },
        [provideRouter([]), LocaleService],
      );
    }

    it('renders the in-stock state', async () => {
      const fixture = await renderWith('IN_STOCK', true);
      const el = fixture.nativeElement.querySelector('[data-testid="product-availability"]');
      expect(el?.textContent?.trim()).toBe(stock.inStock);
      expect(el?.getAttribute('data-state')).toBe('in');
    });

    it('renders the low-stock middle state, which had nowhere to come from before', async () => {
      const fixture = await renderWith('LOW_STOCK', true);
      const el = fixture.nativeElement.querySelector('[data-testid="product-availability"]');
      expect(el?.textContent?.trim()).toBe(stock.lowStock);
      expect(el?.getAttribute('data-state')).toBe('low');
    });

    it('renders the out-of-stock state', async () => {
      const fixture = await renderWith('OUT_OF_STOCK', false);
      const el = fixture.nativeElement.querySelector('[data-testid="product-availability"]');
      expect(el?.textContent?.trim()).toBe(stock.outOfStock);
      expect(el?.getAttribute('data-state')).toBe('out');
    });

    /**
     * Finding P3, first half. The buy box printed the delivery promise between
     * the "Out of stock" line and the disabled button, so the page promised a
     * delivery date for something it refused to sell.
     */
    it('drops the delivery promise when the active variant is out of stock', async () => {
      const fixture = await renderWith('OUT_OF_STOCK', false);
      expect(fixture.nativeElement.querySelector('.delivery')).toBeNull();
    });

    it('keeps the delivery promise on a low-stock variant, which is buyable', async () => {
      const fixture = await renderWith('LOW_STOCK', true);
      const delivery = fixture.nativeElement.querySelector('.delivery');
      expect(delivery?.textContent?.trim()).toBe(getChromeStrings('fr').product.delivery.estimate);
    });

    it('keeps the delivery promise in stock', async () => {
      const fixture = await renderWith('IN_STOCK', true);
      expect(fixture.nativeElement.querySelector('.delivery')).not.toBeNull();
    });

    it('keeps a low-stock variant purchasable', async () => {
      const fixture = await renderWith('LOW_STOCK', true);
      const btn = fixture.nativeElement.querySelector(
        '[data-testid="product-add-to-cart"]',
      ) as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });

    it('binds each state colour to a token, never a raw hex (§10 rows 1 and 7)', () => {
      expect(SOURCE).toContain("[data-state='in'] {\n        color: var(--brand-success-text);");
      expect(SOURCE).toContain("[data-state='low'] {\n        color: var(--brand-warning-text);");
      expect(SOURCE).toContain("[data-state='out'] {\n        color: var(--brand-error);");
      expect(SOURCE).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    });
  });

  describe('reference (agent_docs/storefront/brand-tokens.md, §3 identifiers)', () => {
    it('renders the active variant sku beside its label', async () => {
      const fixture = await renderComponent(ProductSummaryComponent, { input: baseInput }, [
        provideRouter([]),
        LocaleService,
      ]);
      const el = fixture.nativeElement.querySelector('[data-testid="product-reference"]');
      expect(el?.textContent).toContain(getChromeStrings('fr').product.reference);
      expect(
        fixture.nativeElement
          .querySelector('[data-testid="product-reference-value"]')
          ?.textContent?.trim(),
      ).toBe('ECH-BUD-BLK');
    });

    it('follows the selected variant', async () => {
      const fixture = await renderComponent(
        ProductSummaryComponent,
        {
          input: {
            ...baseInput,
            variants: [
              {
                id: 'v1',
                label: 'Black',
                price: 449,
                inStock: true,
                availability: 'IN_STOCK',
                sku: 'A-1',
              },
              {
                id: 'v2',
                label: 'White',
                price: 449,
                inStock: true,
                availability: 'LOW_STOCK',
                sku: 'A-2',
              },
            ],
          },
        },
        [provideRouter([]), LocaleService],
      );
      (
        fixture.nativeElement.querySelector('[data-testid="variant-v2"]') as HTMLButtonElement
      ).click();
      fixture.detectChanges();
      expect(
        fixture.nativeElement
          .querySelector('[data-testid="product-reference-value"]')
          ?.textContent?.trim(),
      ).toBe('A-2');
      expect(
        fixture.nativeElement
          .querySelector('[data-testid="product-availability"]')
          ?.getAttribute('data-state'),
      ).toBe('low');
    });

    it('omits the block when the variant carries no sku', async () => {
      const fixture = await renderComponent(
        ProductSummaryComponent,
        {
          input: {
            ...baseInput,
            variants: [
              {
                id: 'v1',
                label: 'Black',
                price: 449,
                inStock: true,
                availability: 'IN_STOCK',
                sku: '',
              },
            ],
          },
        },
        [provideRouter([]), LocaleService],
      );
      expect(fixture.nativeElement.querySelector('[data-testid="product-reference"]')).toBeNull();
    });

    it('puts the mono face on the identifier and nowhere else (§10 row 10)', () => {
      const value = SOURCE.slice(SOURCE.indexOf('.reference-value {'));
      expect(value).toContain('font-family: var(--brand-font-mono);');
      expect(SOURCE.match(/var\(--brand-font-mono\)/g)?.length).toBe(1);
      // A price must never reach the mono face: JetBrains Mono has no thin
      // space, so the U+202F thousands separator would render full width.
      expect(SOURCE.slice(SOURCE.indexOf('.price-row {'))).not.toContain('--brand-font-mono');
    });
  });

  describe('type scale (agent_docs/storefront/brand-tokens.md, §8.2)', () => {
    it('sets the page-title tier on the h1 with the display face', () => {
      const title = SOURCE.slice(SOURCE.indexOf('.title {'));
      expect(title).toContain('font-family: var(--brand-font-display);');
      expect(title).toContain(
        'font-size: clamp(var(--brand-text-display-mobile), 4vw, var(--brand-text-display));',
      );
      expect(title).toContain('font-weight: 700;');
    });

    it('never shouts a manufacturer name in capitals (§1, §8.2)', async () => {
      expect(SOURCE).not.toContain('text-transform: uppercase');
      const fixture = await renderComponent(ProductSummaryComponent, { input: baseInput }, [
        provideRouter([]),
        LocaleService,
      ]);
      expect(fixture.nativeElement.querySelector('.brand')?.textContent?.trim()).toBe('Echo');
    });
  });

  /**
   * Finding P4, recorded twice (prior pass P4). Add to cart always added one
   * unit, and the button label flipped to "Added to cart", which reads as
   * terminal: a second click looked wrong even though it added another unit.
   */
  describe('quantity and add-to-cart feedback (finding P4)', () => {
    const product = getChromeStrings('fr').product;

    async function renderWith(
      availability: ProductVariantOption['availability'],
      inStock: boolean,
      extra: Partial<Record<string, unknown>> = {},
    ) {
      return renderComponent(
        ProductSummaryComponent,
        {
          input: {
            ...baseInput,
            variants: [
              { id: 'v1', label: 'Black', price: 449, inStock, availability, sku: 'ECH-BUD-BLK' },
            ],
          },
          ...extra,
        },
        [provideRouter([]), LocaleService],
      );
    }

    function stepper(fixture: ComponentFixture<ProductSummaryComponent>): HTMLElement | null {
      return fixture.nativeElement.querySelector('app-stepper');
    }

    function increment(fixture: ComponentFixture<ProductSummaryComponent>, times: number): void {
      for (let i = 0; i < times; i += 1) {
        (
          fixture.nativeElement.querySelector('app-stepper .increment') as HTMLButtonElement
        ).click();
        fixture.detectChanges();
      }
    }

    it('offers a bounded stepper on a purchasable variant', async () => {
      const fixture = await renderWith('IN_STOCK', true);
      const el = stepper(fixture);
      expect(el).not.toBeNull();
      const group = el!.querySelector('[role="group"]');
      expect(group?.getAttribute('aria-label')).toBe(product.quantity.label);
      expect(el!.querySelector('.value')?.textContent?.trim()).toBe('1');
      // The decrement is already at the floor, so it is the min bound proving
      // itself; 99 is the cart's own cap, the server stays the authority.
      expect(
        (el!.querySelector('.decrement') as HTMLButtonElement).disabled,
        'quantity must not go below 1',
      ).toBe(true);
    });

    it('labels its step buttons in the active locale, never the component default', async () => {
      const fixture = await renderWith('IN_STOCK', true);
      const el = stepper(fixture)!;
      expect(el.querySelector('.increment')?.getAttribute('aria-label')).toBe(
        product.quantity.increase,
      );
      expect(el.querySelector('.decrement')?.getAttribute('aria-label')).toBe(
        product.quantity.decrease,
      );
    });

    it('hides the stepper when the active variant cannot be bought', async () => {
      const fixture = await renderWith('OUT_OF_STOCK', false);
      expect(stepper(fixture)).toBeNull();
    });

    it('emits the chosen quantity, not always one', async () => {
      const fixture = await renderWith('IN_STOCK', true);
      const emitted: Array<{ variant: ProductVariantOption; quantity: number }> = [];
      fixture.componentInstance.addToCart.subscribe((e) => emitted.push(e));

      increment(fixture, 2);
      expect(stepper(fixture)!.querySelector('.value')?.textContent?.trim()).toBe('3');

      (
        fixture.nativeElement.querySelector(
          '[data-testid="product-add-to-cart"]',
        ) as HTMLButtonElement
      ).click();
      fixture.detectChanges();

      expect(emitted.length).toBe(1);
      expect(emitted[0].quantity).toBe(3);
      expect(emitted[0].variant.id).toBe('v1');
    });

    it('resets the quantity when the shopper switches variant', async () => {
      const fixture = await renderComponent(
        ProductSummaryComponent,
        {
          input: {
            ...baseInput,
            variants: [
              {
                id: 'v1',
                label: 'Black',
                price: 449,
                inStock: true,
                availability: 'IN_STOCK',
                sku: 'A',
              },
              {
                id: 'v2',
                label: 'White',
                price: 449,
                inStock: true,
                availability: 'IN_STOCK',
                sku: 'B',
              },
            ],
          },
        },
        [provideRouter([]), LocaleService],
      );
      increment(fixture, 3);
      expect(fixture.nativeElement.querySelector('app-stepper .value')?.textContent?.trim()).toBe(
        '4',
      );

      (
        fixture.nativeElement.querySelector('[data-testid="variant-v2"]') as HTMLButtonElement
      ).click();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('app-stepper .value')?.textContent?.trim()).toBe(
        '1',
      );
    });

    it('keeps the button label non-terminal after a successful add', async () => {
      const fixture = await renderWith('IN_STOCK', true, { addState: 'success' });
      const button = fixture.nativeElement.querySelector(
        '[data-testid="product-add-to-cart"]',
      ) as HTMLButtonElement;
      expect(button.textContent?.trim()).toBe(product.addToCart);
      expect(button.disabled).toBe(false);
    });

    it('states how many units landed in the cart, with a way to go there', async () => {
      const fixture = await renderWith('IN_STOCK', true);
      increment(fixture, 1);
      // The count names what was SENT, so the add has to happen before the
      // owner reports success; the stepper stays live and must not rewrite it.
      (
        fixture.nativeElement.querySelector(
          '[data-testid="product-add-to-cart"]',
        ) as HTMLButtonElement
      ).click();
      fixture.componentRef.setInput('addState', 'success');
      fixture.detectChanges();
      increment(fixture, 1);

      const status = fixture.nativeElement.querySelector(
        '[data-testid="product-add-to-cart-status"]',
      );
      expect(status?.getAttribute('role')).toBe('status');
      expect(status?.textContent).toContain(product.addedToCartWithCount.replace('{count}', '2'));
      const link = status?.querySelector('a') as HTMLAnchorElement;
      expect(link.textContent?.trim()).toBe(product.viewCart);
      expect(link.getAttribute('href')).toBe('/fr/cart');
    });

    it('announces the same count to screen readers', async () => {
      const fixture = await renderWith('IN_STOCK', true, { addState: 'success' });
      const live = fixture.nativeElement.querySelector('.sr-only[aria-live]');
      expect(live?.textContent?.trim()).toBe(product.addedToCartWithCount.replace('{count}', '1'));
    });

    it('shows no status line while idle', async () => {
      const fixture = await renderWith('IN_STOCK', true);
      expect(
        fixture.nativeElement.querySelector('[data-testid="product-add-to-cart-status"]'),
      ).toBeNull();
    });

    it('passes axe with the stepper and the success status rendered', async () => {
      const fixture = await renderWith('IN_STOCK', true, { addState: 'success' });
      const wrapper = attachToBody(fixture.nativeElement);
      await assertAxeClean(wrapper);
      wrapper.remove();
    });
  });

  /**
   * Finding P3, second half. An out-of-stock buy box offered nothing to do.
   * The wishlist already IS the interest signal the back-in-stock fan-out
   * reads (`back-in-stock.listener.ts`, operator decision O6), so the control
   * is the wishlist toggle relabelled, with no new endpoint behind it.
   */
  describe('back-in-stock notify control (finding P3)', () => {
    const strings = getChromeStrings('fr').product;

    async function renderWith(
      availability: ProductVariantOption['availability'],
      inStock: boolean,
    ) {
      return renderComponent(
        ProductSummaryComponent,
        {
          input: {
            ...baseInput,
            productId: 'prod-1',
            variants: [
              { id: 'v1', label: 'Black', price: 449, inStock, availability, sku: 'ECH-BUD-BLK' },
            ],
          },
        },
        [
          provideRouter([]),
          LocaleService,
          ToastService,
          // The toggle reads membership from the shared store (plan E3); the
          // buy box only owns the words on it, so a read-only stand-in is all
          // this suite needs.
          {
            provide: WishlistStateService,
            useValue: {
              isWishlisted: () => false,
              add: async () => undefined,
              remove: async () => undefined,
            },
          },
        ],
      );
    }

    it('relabels the wishlist control as a notify control when out of stock', async () => {
      const fixture = await renderWith('OUT_OF_STOCK', false);
      const label = fixture.nativeElement.querySelector('[data-testid="wishlist-toggle-label"]');
      expect(label?.textContent?.trim()).toBe(strings.backInStock.notify);
    });

    it('keeps the plain wishlist copy while the product can be bought', async () => {
      const fixture = await renderWith('IN_STOCK', true);
      const label = fixture.nativeElement.querySelector('[data-testid="wishlist-toggle-label"]');
      expect(label?.textContent?.trim()).toBe(strings.wishlist.add);
    });

    it('names the consent switch and links to the preference centre', async () => {
      const fixture = await renderWith('OUT_OF_STOCK', false);
      const hint = fixture.nativeElement.querySelector(
        '[data-testid="product-back-in-stock-hint"]',
      );
      expect(hint?.textContent).toContain(strings.backInStock.hint);
      const link = hint?.querySelector('a') as HTMLAnchorElement;
      expect(link.textContent?.trim()).toBe(strings.backInStock.preferencesLink);
      expect(link.getAttribute('href')).toBe('/fr/account/preferences');
    });

    it('shows no hint while the product is in stock', async () => {
      const fixture = await renderWith('IN_STOCK', true);
      expect(
        fixture.nativeElement.querySelector('[data-testid="product-back-in-stock-hint"]'),
      ).toBeNull();
    });

    it('passes axe with the out-of-stock notify control rendered', async () => {
      const fixture = await renderWith('OUT_OF_STOCK', false);
      const wrapper = attachToBody(fixture.nativeElement);
      await assertAxeClean(wrapper);
      wrapper.remove();
    });
  });
});
