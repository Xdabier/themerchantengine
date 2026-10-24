import { Dialog, DialogModule } from '@angular/cdk/dialog';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import { AssetsService, type AssetReferences } from '@admin-services';
import { ApiError } from '@admin-types';
import { openAssetReferencesDialog } from './references.dialog';

expect.extend(toHaveNoViolations);

const REFS: AssetReferences = {
  products: [
    { kind: 'product', id: 'prod-1', label: 'classic-tee', route: '/products/prod-1/edit' },
  ],
  variants: [
    {
      kind: 'variant',
      id: 'var-1',
      label: 'digital-album · SKU-1',
      route: '/products/prod-1/edit',
    },
  ],
  reviews: [{ kind: 'review', id: 'rev-1', label: 'mug · Layla Saab', route: '/reviews/rev-1' }],
  returns: [{ kind: 'return', id: 'ret-1', label: 'RET-2026-000001', route: '/returns/ret-1' }],
  categories: [{ kind: 'category', id: 'cat-1', label: 'electronics', route: '/categories/cat-1' }],
  sections: [],
  total: 5,
};

class AssetsServiceStub {
  readonly getReferencesSpy = jest.fn();
  getReferences(...args: unknown[]) {
    return this.getReferencesSpy(...args);
  }
}

@Component({
  standalone: true,
  imports: [DialogModule],
  template: '',
})
class HostComponent {
  private readonly dialog = inject(Dialog);
  open(assetId: string): Promise<void> {
    return openAssetReferencesDialog(this.dialog, { assetId, assetLabel: 'asset-foo' });
  }
}

function dialogEl(): HTMLElement {
  const el = document.body.querySelector('[role="dialog"]');
  if (!el) throw new Error('dialog not mounted');
  return el as HTMLElement;
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

describe('AssetReferencesDialogComponent', () => {
  let service: AssetsServiceStub;
  let router: Router;

  beforeEach(async () => {
    service = new AssetsServiceStub();
    service.getReferencesSpy.mockReturnValue(of(REFS));

    await TestBed.configureTestingModule({
      imports: [HostComponent, DialogModule],
      providers: [
        { provide: AssetsService, useValue: service },
        provideRouter([{ path: '**', component: HostComponent }]),
      ],
    }).compileComponents();

    router = TestBed.inject(Router);
  });

  afterEach(() => {
    document.querySelectorAll('.cdk-overlay-container').forEach((el) => el.remove());
  });

  it('fetches references and renders all six chips', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    void fixture.componentInstance.open('asset-1');
    await flush();
    fixture.detectChanges();

    expect(service.getReferencesSpy).toHaveBeenCalledWith('asset-1');
    const chips = dialogEl().querySelectorAll('[data-testid^="asset-references-chip-"]');
    expect(chips).toHaveLength(7); // all + six kinds
    const total = dialogEl().querySelector('[data-testid="asset-references-total"]');
    expect(total?.textContent).toContain('5');
  });

  it('renders one row per reference under the All filter', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    void fixture.componentInstance.open('asset-1');
    await flush();
    fixture.detectChanges();
    const rows = dialogEl().querySelectorAll('[data-testid^="asset-references-row-"]');
    expect(rows).toHaveLength(5);
  });

  it('filters rows when a kind chip is pressed', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    void fixture.componentInstance.open('asset-1');
    await flush();
    fixture.detectChanges();

    const productChip = dialogEl().querySelector<HTMLButtonElement>(
      '[data-testid="asset-references-chip-product"]',
    );
    productChip?.click();
    fixture.detectChanges();

    const rows = dialogEl().querySelectorAll('[data-testid^="asset-references-row-"]');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.getAttribute('data-testid')).toBe('asset-references-row-product-prod-1');
  });

  it('navigates to the entity edit route when a row is activated', async () => {
    const navSpy = jest.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    void fixture.componentInstance.open('asset-1');
    await flush();
    fixture.detectChanges();

    const row = dialogEl().querySelector<HTMLButtonElement>(
      '[data-testid="asset-references-row-review-rev-1"]',
    );
    row?.click();
    await flush();

    expect(navSpy).toHaveBeenCalledWith('/reviews/rev-1');
  });

  it('shows an empty state when nothing references the asset', async () => {
    service.getReferencesSpy.mockReturnValueOnce(
      of({
        products: [],
        variants: [],
        reviews: [],
        returns: [],
        categories: [],
        sections: [],
        total: 0,
      } satisfies AssetReferences),
    );
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    void fixture.componentInstance.open('asset-1');
    await flush();
    fixture.detectChanges();

    const empty = dialogEl().querySelector('[data-testid="asset-references-empty"]');
    expect(empty).not.toBeNull();

    const result = await axe(dialogEl());
    expect(result).toHaveNoViolations();
  });

  it('surfaces an inline error with role="alert" when the references request fails', async () => {
    service.getReferencesSpy.mockReturnValueOnce(
      throwError(() => new ApiError({ code: 'INTERNAL_SERVER_ERROR', message: 'boom' })),
    );
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    void fixture.componentInstance.open('asset-1');
    await flush();
    fixture.detectChanges();

    const error = dialogEl().querySelector('[data-testid="asset-references-error"]');
    expect(error?.textContent).toContain('boom');
    expect(error?.getAttribute('role')).toBe('alert');
    expect(error?.getAttribute('aria-live')).toBe('assertive');

    const result = await axe(dialogEl());
    expect(result).toHaveNoViolations();
  });

  it('is axe-clean in the loaded state', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    void fixture.componentInstance.open('asset-1');
    await flush();
    fixture.detectChanges();

    const result = await axe(dialogEl());
    expect(result).toHaveNoViolations();
  });
});
