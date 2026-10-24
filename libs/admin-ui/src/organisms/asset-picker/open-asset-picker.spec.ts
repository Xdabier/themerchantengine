import { Dialog, DialogModule } from '@angular/cdk/dialog';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { tryPickVariantUrl } from '@common/asset-variants';
import { AssetsService, type Asset, type ListAssetsResponse } from '@admin-services';
import { AssetPickerComponent, type AssetPickerResult } from './asset-picker.component';
import { openAssetPicker } from './open-asset-picker';

const ONLY_VARIANTS = {
  thumbnail: {
    webp: {
      url: 'https://cdn.example/only-thumb.webp',
      storagePath: 'pub/o-t.webp',
      width: 160,
      height: 120,
      size: 100,
    },
    avif: {
      url: 'https://cdn.example/only-thumb.avif',
      storagePath: 'pub/o-t.avif',
      width: 160,
      height: 120,
      size: 90,
    },
  },
  small: {
    webp: {
      url: 'https://cdn.example/only-small.webp',
      storagePath: 'pub/o-s.webp',
      width: 320,
      height: 240,
      size: 200,
    },
    avif: {
      url: 'https://cdn.example/only-small.avif',
      storagePath: 'pub/o-s.avif',
      width: 320,
      height: 240,
      size: 180,
    },
  },
  medium: {
    webp: {
      url: 'https://cdn.example/only-med.webp',
      storagePath: 'pub/o-m.webp',
      width: 640,
      height: 480,
      size: 400,
    },
    avif: {
      url: 'https://cdn.example/only-med.avif',
      storagePath: 'pub/o-m.avif',
      width: 640,
      height: 480,
      size: 360,
    },
  },
  large: {
    webp: {
      url: 'https://cdn.example/only-large.webp',
      storagePath: 'pub/o-l.webp',
      width: 1280,
      height: 960,
      size: 800,
    },
    avif: {
      url: 'https://cdn.example/only-large.avif',
      storagePath: 'pub/o-l.avif',
      width: 1280,
      height: 960,
      size: 720,
    },
  },
};

const ONE_ASSET: Asset = {
  id: 'asset-only',
  url: 'https://cdn.example/only.png',
  status: 'READY',
  type: 'IMAGE',
  mimeType: 'image/png',
  fileSize: 100,
  alt: 'Only',
  variants: ONLY_VARIANTS,
  originalStoragePath: null,
  createdAt: '2026-04-01T00:00:00.000Z',
  updatedAt: '2026-04-01T00:00:00.000Z',
};

class AssetsServiceStub {
  list(): ReturnType<typeof of<ListAssetsResponse>> {
    return of({
      data: [ONE_ASSET],
      meta: { total: 1, page: 1, pageSize: 24, totalPages: 1 },
    });
  }

  // AV3 — picker tile binds via the resolver shim. Delegate to the canonical
  // shared resolver so the stub does not drift from production behaviour.
  tryPublicVariantUrl(
    asset: { id: string; status: string; variants?: unknown } | null | undefined,
    intent: 'thumbnail' | 'card' | 'banner' | 'hero' | 'detail',
  ) {
    if (!asset) return null;
    return tryPickVariantUrl(
      {
        id: asset.id,
        status: asset.status as 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED',
        variants: asset.variants,
      },
      intent,
    );
  }
}

@Component({
  standalone: true,
  imports: [DialogModule],
  template: '',
})
class HostComponent {
  readonly dialog = inject(Dialog);
}

describe('openAssetPicker', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent, AssetPickerComponent, DialogModule],
      providers: [{ provide: AssetsService, useClass: AssetsServiceStub }],
    }).compileComponents();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('opens the picker with brand classes + role=dialog and resolves the discriminated union', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const promise = openAssetPicker(fixture.componentInstance.dialog, { mode: 'single' });
    await new Promise((r) => setTimeout(r, 0));
    fixture.detectChanges();

    const dialogEl = document.body.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialogEl).toBeTruthy();
    expect(dialogEl.getAttribute('aria-modal')).toBe('true');
    // The accessible name is sourced from `aria-labelledby` only — the
    // helper deliberately omits `ariaLabel` to avoid the dual-label
    // double-announcement trap. The referenced heading must surface the
    // default single-select title in its DOM tree.
    expect(dialogEl.textContent).toContain('Select an asset');

    const card = dialogEl.querySelector<HTMLButtonElement>('button[role="option"]');
    card?.click();
    const result: AssetPickerResult = await promise;
    expect(result).toEqual({ kind: 'select-single', asset: ONE_ASSET });
  });

  it('resolves with kind="cancel" when the dialog closes without a selection', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const promise = openAssetPicker(fixture.componentInstance.dialog, { mode: 'multi' });
    await new Promise((r) => setTimeout(r, 0));
    fixture.detectChanges();

    const close = document.body.querySelector<HTMLButtonElement>(
      '[data-testid="asset-picker-close"]',
    );
    close?.click();
    const result: AssetPickerResult = await promise;
    expect(result).toEqual({ kind: 'cancel' });
  });

  it('resolves with kind="select-multi" after toggling cards and confirming in multi mode', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const promise = openAssetPicker(fixture.componentInstance.dialog, { mode: 'multi' });
    await new Promise((r) => setTimeout(r, 0));
    fixture.detectChanges();

    const card = document.body.querySelector<HTMLButtonElement>('button[role="option"]');
    card?.click();
    fixture.detectChanges();
    const confirm = document.body.querySelector<HTMLButtonElement>(
      '[data-testid="asset-picker-confirm"]',
    );
    confirm?.click();

    const result: AssetPickerResult = await promise;
    expect(result.kind).toBe('select-multi');
    if (result.kind === 'select-multi') {
      expect(result.assets.map((a) => a.id)).toEqual([ONE_ASSET.id]);
    }
  });

  it('resolves with kind="cancel" when the CDK ref closes with `undefined`', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const dialog = fixture.componentInstance.dialog;
    const promise = openAssetPicker(dialog, { mode: 'single' });
    await new Promise((r) => setTimeout(r, 0));
    fixture.detectChanges();

    // Reach into the open ref and close without a value — covers the
    // `value ?? { kind: 'cancel' }` nullish-coalescing fallback inside the
    // helper. CDK's Esc + backdrop paths both emit `undefined` to `closed`.
    const ref = dialog.openDialogs[dialog.openDialogs.length - 1];
    ref.close();
    const result: AssetPickerResult = await promise;
    expect(result).toEqual({ kind: 'cancel' });
  });
});
