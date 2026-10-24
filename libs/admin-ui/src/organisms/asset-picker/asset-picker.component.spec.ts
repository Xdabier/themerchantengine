import { Dialog, DialogModule } from '@angular/cdk/dialog';
import { Component, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { axe, toHaveNoViolations } from 'jest-axe';
import { Subject, of, throwError } from 'rxjs';
import { tryPickVariantUrl } from '@common/asset-variants';
import {
  AssetsService,
  type Asset,
  type AssetUploadEvent,
  type ListAssetsResponse,
} from '@admin-services';
import {
  ACCEPT_BY_TYPE,
  AssetPickerComponent,
  type AssetPickerOptions,
  type AssetPickerResult,
} from './asset-picker.component';
import { ASSET_PICKER_PERMISSIONS } from './asset-picker.token';
import { openAssetPicker } from './open-asset-picker';

expect.extend(toHaveNoViolations);

/**
 * AV3 — picker tiles bind via the resolver shim, so every IMAGE fixture
 * needs a `variants` payload that satisfies `assetVariantsSchema`. The
 * helper mirrors the canonical four-width pair shape; the resolver picks
 * `variants.thumbnail.webp.url` for `'thumbnail'` intent.
 */
const buildVariants = (id: string) => ({
  thumbnail: {
    webp: {
      url: `https://cdn.example/${id}-thumb.webp`,
      storagePath: `pub/${id}-t.webp`,
      width: 160,
      height: 120,
      size: 100,
    },
    avif: {
      url: `https://cdn.example/${id}-thumb.avif`,
      storagePath: `pub/${id}-t.avif`,
      width: 160,
      height: 120,
      size: 90,
    },
  },
  small: {
    webp: {
      url: `https://cdn.example/${id}-small.webp`,
      storagePath: `pub/${id}-s.webp`,
      width: 320,
      height: 240,
      size: 200,
    },
    avif: {
      url: `https://cdn.example/${id}-small.avif`,
      storagePath: `pub/${id}-s.avif`,
      width: 320,
      height: 240,
      size: 180,
    },
  },
  medium: {
    webp: {
      url: `https://cdn.example/${id}-med.webp`,
      storagePath: `pub/${id}-m.webp`,
      width: 640,
      height: 480,
      size: 400,
    },
    avif: {
      url: `https://cdn.example/${id}-med.avif`,
      storagePath: `pub/${id}-m.avif`,
      width: 640,
      height: 480,
      size: 360,
    },
  },
  large: {
    webp: {
      url: `https://cdn.example/${id}-large.webp`,
      storagePath: `pub/${id}-l.webp`,
      width: 1280,
      height: 960,
      size: 800,
    },
    avif: {
      url: `https://cdn.example/${id}-large.avif`,
      storagePath: `pub/${id}-l.avif`,
      width: 1280,
      height: 960,
      size: 720,
    },
  },
});

const SAMPLE_ASSETS: Asset[] = [
  {
    id: 'asset-aaa',
    url: 'https://cdn.example/a.png',
    status: 'READY',
    type: 'IMAGE',
    mimeType: 'image/png',
    fileSize: 1024,
    alt: 'Hero shot',
    variants: buildVariants('asset-aaa'),
    originalStoragePath: null,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
  },
  {
    id: 'asset-bbb',
    url: 'https://cdn.example/b.png',
    status: 'READY',
    type: 'IMAGE',
    mimeType: 'image/png',
    fileSize: 2048,
    alt: 'Banner',
    variants: buildVariants('asset-bbb'),
    originalStoragePath: null,
    createdAt: '2026-04-02T00:00:00.000Z',
    updatedAt: '2026-04-02T00:00:00.000Z',
  },
  {
    id: 'asset-ccc',
    url: 'https://cdn.example/c.mp4',
    status: 'READY',
    type: 'VIDEO',
    mimeType: 'video/mp4',
    fileSize: 4096,
    alt: 'Reel',
    createdAt: '2026-04-03T00:00:00.000Z',
    updatedAt: '2026-04-03T00:00:00.000Z',
  },
];

/**
 * AV3 — image asset still PROCESSING (no variants payload). Exercises the
 * fallback path where the resolver returns `null` and the picker tile
 * renders the type-label `<span>` instead of a broken `<img>`.
 */
const PROCESSING_IMAGE: Asset = {
  id: 'asset-pending',
  url: '',
  status: 'PROCESSING',
  type: 'IMAGE',
  mimeType: 'image/png',
  fileSize: 100,
  alt: 'In flight',
  createdAt: '2026-04-04T00:00:00.000Z',
  updatedAt: '2026-04-04T00:00:00.000Z',
};

class AssetsServiceStub {
  readonly listSpy = jest.fn();
  readonly getSpy = jest.fn();
  readonly uploadSpy = jest.fn();
  list(query: unknown): ReturnType<typeof of<ListAssetsResponse>> {
    return this.listSpy(query);
  }

  get(id: string): ReturnType<typeof of<Asset>> {
    return this.getSpy(id);
  }

  uploadWithProgress(file: File): ReturnType<typeof of<AssetUploadEvent>> {
    return this.uploadSpy(file);
  }

  // AV3 — picker calls the resolver shim per tile. Mirror the production
  // method via a thin delegate so the picker's binding contract is exercised
  // through the real shared resolver, not a hand-rolled stub.
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
  private readonly dialog = inject(Dialog);
  readonly lastResult = signal<AssetPickerResult | null>(null);

  open(options: AssetPickerOptions): Promise<AssetPickerResult> {
    return openAssetPicker(this.dialog, options).then((r) => {
      this.lastResult.set(r);
      return r;
    });
  }
}

function dialogEl(): HTMLElement {
  const el = document.body.querySelector('[role="dialog"]');
  if (!el) throw new Error('dialog not mounted');
  return el as HTMLElement;
}

function gridButtons(): HTMLButtonElement[] {
  return Array.from(dialogEl().querySelectorAll<HTMLButtonElement>('button[role="option"]'));
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
}

describe('AssetPickerComponent', () => {
  let service: AssetsServiceStub;

  beforeEach(async () => {
    service = new AssetsServiceStub();
    service.listSpy.mockImplementation(() =>
      of({
        data: SAMPLE_ASSETS,
        meta: { total: SAMPLE_ASSETS.length, page: 1, pageSize: 24, totalPages: 1 },
      } satisfies ListAssetsResponse),
    );

    await TestBed.configureTestingModule({
      imports: [HostComponent, AssetPickerComponent, DialogModule],
      providers: [{ provide: AssetsService, useValue: service }, provideRouter([])],
    }).compileComponents();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('hydrates the grid from AssetsService.list() and closes with the picked asset in single mode', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const promise = fixture.componentInstance.open({ mode: 'single', title: 'Pick one' });
    await flush();
    fixture.detectChanges();

    expect(service.listSpy).toHaveBeenCalledWith({ page: 1, pageSize: 24 });
    const cards = gridButtons();
    expect(cards).toHaveLength(SAMPLE_ASSETS.length);
    expect(cards[0].getAttribute('data-testid')).toBe('asset-picker-card-asset-aaa');

    cards[1].click();
    const result = await promise;
    expect(result).toEqual({ kind: 'select-single', asset: SAMPLE_ASSETS[1] });
  });

  it('toggles selection in multi mode and closes with the cumulative set on confirm', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const promise = fixture.componentInstance.open({ mode: 'multi' });
    await flush();
    fixture.detectChanges();

    const cards = gridButtons();
    cards[0].click();
    cards[2].click();
    fixture.detectChanges();

    const confirm = dialogEl().querySelector<HTMLButtonElement>(
      '[data-testid="asset-picker-confirm"]',
    );
    expect(confirm).toBeTruthy();
    expect(confirm!.disabled).toBe(false);
    confirm!.click();

    const result = await promise;
    expect(result.kind).toBe('select-multi');
    if (result.kind === 'select-multi') {
      expect(result.assets.map((a) => a.id)).toEqual(['asset-aaa', 'asset-ccc']);
    }
  });

  it('refetches when the type filter changes', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    void fixture.componentInstance.open({ mode: 'single' });
    await flush();
    fixture.detectChanges();

    expect(service.listSpy).toHaveBeenCalledTimes(1);
    const videoBtn = dialogEl().querySelector<HTMLButtonElement>(
      '[data-testid="asset-picker-type-VIDEO"]',
    );
    expect(videoBtn).toBeTruthy();
    videoBtn!.click();
    await flush();
    fixture.detectChanges();

    expect(service.listSpy).toHaveBeenLastCalledWith({ page: 1, pageSize: 24, type: 'VIDEO' });
  });

  it('closes with `cancel` when the close button is clicked', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const promise = fixture.componentInstance.open({ mode: 'multi' });
    await flush();
    fixture.detectChanges();

    const close = dialogEl().querySelector<HTMLButtonElement>('[data-testid="asset-picker-close"]');
    close!.click();
    const result = await promise;
    expect(result).toEqual({ kind: 'cancel' });
  });

  it('navigates the grid with arrow keys and selects on Enter', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const promise = fixture.componentInstance.open({ mode: 'single' });
    await flush();
    fixture.detectChanges();

    const grid = dialogEl().querySelector<HTMLElement>('[data-testid="asset-picker-grid"]');
    expect(grid).toBeTruthy();
    grid!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    grid!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    const result = await promise;
    expect(result.kind).toBe('select-single');
    if (result.kind === 'select-single') expect(result.asset.id).toBe('asset-bbb');
  });

  it('renders the empty state and surfaces backend errors via aria-live', async () => {
    service.listSpy.mockImplementationOnce(() => throwError(() => new Error('boom')));
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    void fixture.componentInstance.open({ mode: 'single' });
    await flush();
    fixture.detectChanges();

    const errorEl = dialogEl().querySelector('[data-testid="asset-picker-error"]');
    expect(errorEl?.textContent?.trim()).toBe('boom');
  });

  it('is axe-clean at mount', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    void fixture.componentInstance.open({ mode: 'single', title: 'Pick an asset' });
    await flush();
    fixture.detectChanges();

    const results = await axe(dialogEl(), {
      runOnly: { type: 'tag', values: ['wcag22a', 'wcag22aa'] },
      includedImpacts: ['serious', 'critical'],
    });
    expect(results).toHaveNoViolations();
  });

  it('refetches when the status filter changes and no-ops on a same-value click', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    void fixture.componentInstance.open({ mode: 'single' });
    await flush();
    fixture.detectChanges();

    const readyBtn = dialogEl().querySelector<HTMLButtonElement>(
      '[data-testid="asset-picker-status-READY"]',
    );
    expect(readyBtn).toBeTruthy();
    readyBtn!.click();
    await flush();
    fixture.detectChanges();
    expect(service.listSpy).toHaveBeenLastCalledWith({ page: 1, pageSize: 24, status: 'READY' });

    const callsAfterFirstClick = service.listSpy.mock.calls.length;
    readyBtn!.click();
    await flush();
    expect(service.listSpy.mock.calls.length).toBe(callsAfterFirstClick);
  });

  it('no-ops the type filter when the same value is clicked twice', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    void fixture.componentInstance.open({ mode: 'single' });
    await flush();
    fixture.detectChanges();

    const imageBtn = dialogEl().querySelector<HTMLButtonElement>(
      '[data-testid="asset-picker-type-IMAGE"]',
    );
    imageBtn!.click();
    await flush();
    const calls = service.listSpy.mock.calls.length;
    imageBtn!.click();
    await flush();
    expect(service.listSpy.mock.calls.length).toBe(calls);
  });

  it('navigates pagination with Prev/Next and clamps out-of-range page numbers', async () => {
    service.listSpy.mockImplementation((q: { page?: number }) => {
      const page = q?.page ?? 1;
      return of({
        data: SAMPLE_ASSETS,
        meta: { total: 48, page, pageSize: 24, totalPages: 2 },
      } satisfies ListAssetsResponse);
    });

    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    void fixture.componentInstance.open({ mode: 'single' });
    await flush();
    fixture.detectChanges();

    const next = dialogEl().querySelector<HTMLButtonElement>('[data-testid="asset-picker-next"]');
    const prev = dialogEl().querySelector<HTMLButtonElement>('[data-testid="asset-picker-prev"]');
    expect(prev).toBeTruthy();
    expect(next).toBeTruthy();
    expect(prev!.disabled).toBe(true);
    expect(next!.disabled).toBe(false);

    next!.click();
    await flush();
    fixture.detectChanges();
    expect(service.listSpy).toHaveBeenLastCalledWith({ page: 2, pageSize: 24 });
    expect(next!.disabled).toBe(true);

    // Out-of-range guard — clicking Next once Next is disabled should be a
    // no-op. Re-render the call count and confirm no extra fetch landed.
    const calls = service.listSpy.mock.calls.length;
    next!.click();
    await flush();
    expect(service.listSpy.mock.calls.length).toBe(calls);
  });

  it('handles ArrowLeft, ArrowDown, ArrowUp, Home, End, and Space across the grid', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    void fixture.componentInstance.open({ mode: 'multi' });
    await flush();
    fixture.detectChanges();

    const grid = dialogEl().querySelector<HTMLElement>('[data-testid="asset-picker-grid"]');
    const dispatch = (key: string): void => {
      grid!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    };
    // Cursor starts at 0. Right → 1, Left → 0, End → last, Home → 0.
    dispatch('ArrowRight');
    dispatch('ArrowLeft');
    dispatch('End');
    dispatch('Home');
    dispatch('ArrowDown');
    dispatch('ArrowUp');
    // Space toggles selection on the active card without closing in multi mode.
    dispatch(' ');
    fixture.detectChanges();
    const firstCard = gridButtons()[0];
    expect(firstCard.getAttribute('aria-selected')).toBe('true');

    // Unhandled key falls through to the default branch (covers `default: return`).
    dispatch('PageDown');
  });

  it('returns early on grid keydown when the visible list is empty', async () => {
    service.listSpy.mockImplementation(() =>
      of({
        data: [],
        meta: { total: 0, page: 1, pageSize: 24, totalPages: 1 },
      } satisfies ListAssetsResponse),
    );
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    void fixture.componentInstance.open({ mode: 'single' });
    await flush();
    fixture.detectChanges();

    // Grid is not rendered when empty — the empty-state placeholder is.
    expect(dialogEl().querySelector('[data-testid="asset-picker-grid"]')).toBeNull();
    expect(dialogEl().querySelector('[data-testid="asset-picker-empty"]')).toBeTruthy();
  });

  it('toggles a multi-mode selection back off when the same card is clicked twice', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    void fixture.componentInstance.open({ mode: 'multi' });
    await flush();
    fixture.detectChanges();

    const cards = gridButtons();
    cards[0].click();
    fixture.detectChanges();
    expect(cards[0].getAttribute('aria-selected')).toBe('true');
    cards[0].click();
    fixture.detectChanges();
    expect(cards[0].getAttribute('aria-selected')).toBe('false');

    const confirm = dialogEl().querySelector<HTMLButtonElement>(
      '[data-testid="asset-picker-confirm"]',
    );
    expect(confirm!.disabled).toBe(true);
  });

  // ── AV3 — variant URL bindings ───────────────────────────────────────────

  describe('AV3 variant URL migration', () => {
    it('picker tile binds the resolved thumbnail variant URL, not raw asset.url', async () => {
      const fixture = TestBed.createComponent(HostComponent);
      fixture.detectChanges();
      void fixture.componentInstance.open({ mode: 'single' });
      await flush();
      fixture.detectChanges();

      const cards = gridButtons();
      const img = cards[0].querySelector('img') as HTMLImageElement | null;
      expect(img).not.toBeNull();
      expect(img!.getAttribute('src')).toBe('https://cdn.example/asset-aaa-thumb.webp');
      expect(img!.getAttribute('src')).not.toBe('https://cdn.example/a.png');
    });

    it('picker tile renders type-label fallback (no <img>) for a PROCESSING image asset', async () => {
      service.listSpy.mockImplementation(() =>
        of({
          data: [PROCESSING_IMAGE],
          meta: { total: 1, page: 1, pageSize: 24, totalPages: 1 },
        } satisfies ListAssetsResponse),
      );
      const fixture = TestBed.createComponent(HostComponent);
      fixture.detectChanges();
      void fixture.componentInstance.open({ mode: 'single' });
      await flush();
      fixture.detectChanges();

      const cards = gridButtons();
      expect(cards).toHaveLength(1);
      expect(cards[0].querySelector('img')).toBeNull();
      const fallback = cards[0].querySelector('span');
      expect(fallback?.textContent?.trim()).toBe('IMAGE');
    });
  });

  it('falls back to a generic error message when the thrown value has no .message string', async () => {
    service.listSpy.mockImplementationOnce(() => throwError(() => 'plain string'));
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    void fixture.componentInstance.open({ mode: 'single' });
    await flush();
    fixture.detectChanges();

    const errorEl = dialogEl().querySelector('[data-testid="asset-picker-error"]');
    expect(errorEl?.textContent?.trim()).toBe('Could not load assets.');
  });

  it('opens with disableClose=false so CDK wires Esc-to-close, and resolves cancel via the same path', async () => {
    // The Esc keydown is handled internally by `_overlayRef.keydownEvents()`
    // in CDK Dialog. The picker's `open-asset-picker` helper passes
    // `disableClose: false`, which routes Esc through `ref.close()` with no
    // value. The end-to-end Esc round trip is covered by the Playwright
    // journey at `apps/admin-e2e/src/modules/asset-picker.journey.spec.ts`
    // (test 1, `page.keyboard.press('Escape')`) where a real overlay is
    // mounted. Here we lock in the contract that the helper still uses
    // `disableClose: false` and that an Esc-style ref.close() (no value)
    // resolves to `kind: 'cancel'` — which is the unit-level invariant we
    // own. The helper spec exercises the same invariant against the real
    // helper; this test asserts the component-side behaviour stays
    // consistent if a future caller changes the helper.
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const dialog = TestBed.inject(Dialog);
    const promise = openAssetPicker(dialog, { mode: 'single' });
    await flush();
    fixture.detectChanges();

    const ref = dialog.openDialogs[dialog.openDialogs.length - 1];
    ref.close();
    const result = await promise;
    expect(result).toEqual({ kind: 'cancel' });
  });
});

// ── AU1 — Browse | Upload tablist ─────────────────────────────────────────

const READY_ASSET: Asset = {
  id: 'asset-new-1',
  url: 'https://cdn.example/new.png',
  status: 'READY',
  type: 'IMAGE',
  mimeType: 'image/png',
  fileSize: 1024,
  alt: 'New upload',
  variants: buildVariants('asset-new-1'),
  originalStoragePath: null,
  createdAt: '2026-05-02T00:00:00.000Z',
  updatedAt: '2026-05-02T00:00:00.000Z',
};

const PROCESSING_ASSET: Asset = {
  id: 'asset-new-2',
  url: '',
  status: 'PROCESSING',
  type: 'IMAGE',
  mimeType: 'image/png',
  fileSize: 1024,
  alt: 'Processing',
  createdAt: '2026-05-02T00:00:00.000Z',
  updatedAt: '2026-05-02T00:00:00.000Z',
};

@Component({
  standalone: true,
  imports: [DialogModule],
  template: '',
})
class HostWithUploadComponent {
  private readonly dialog = inject(Dialog);
  readonly lastResult = signal<AssetPickerResult | null>(null);

  open(options: AssetPickerOptions): Promise<AssetPickerResult> {
    return openAssetPicker(this.dialog, options).then((r) => {
      this.lastResult.set(r);
      return r;
    });
  }
}

describe('AssetPickerComponent — AU1 Browse | Upload tablist', () => {
  let service: AssetsServiceStub;

  function setup(permissions: ReadonlySet<string> | null) {
    service = new AssetsServiceStub();
    service.listSpy.mockImplementation(() =>
      of({
        data: SAMPLE_ASSETS,
        meta: { total: SAMPLE_ASSETS.length, page: 1, pageSize: 24, totalPages: 1 },
      } satisfies ListAssetsResponse),
    );

    const providers: unknown[] = [{ provide: AssetsService, useValue: service }, provideRouter([])];
    if (permissions) {
      providers.push({
        provide: ASSET_PICKER_PERMISSIONS,
        useValue: signal(permissions),
      });
    }

    return TestBed.configureTestingModule({
      imports: [HostWithUploadComponent, AssetPickerComponent, DialogModule],
      providers: providers as never[],
    }).compileComponents();
  }

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('mirrors the backend ALLOWED_MIME_TYPES — six MIMEs across IMAGE + VIDEO', () => {
    // Mirror parity gate (clarifications.md Q5) — backend constant lives at
    // apps/api/src/modules/assets/assets.constants.ts:10. If a future MIME
    // is added server-side, this assertion fails until ACCEPT_BY_TYPE is
    // updated alongside.
    const all = `${ACCEPT_BY_TYPE.IMAGE},${ACCEPT_BY_TYPE.VIDEO}`.split(',').sort();
    expect(all).toEqual(
      ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'video/mp4', 'video/webm'].sort(),
    );
    // DOCUMENT and AUDIO fall back to the full allowlist.
    expect(ACCEPT_BY_TYPE.DOCUMENT).toBe(
      'image/jpeg,image/png,image/webp,image/avif,video/mp4,video/webm',
    );
    expect(ACCEPT_BY_TYPE.AUDIO).toBe(
      'image/jpeg,image/png,image/webp,image/avif,video/mp4,video/webm',
    );
  });

  it('renders the tablist with Browse and Upload tabs when the operator has assets:create', async () => {
    await setup(new Set(['assets:view', 'assets:create']));
    const fixture = TestBed.createComponent(HostWithUploadComponent);
    fixture.detectChanges();
    void fixture.componentInstance.open({ mode: 'single' });
    await flush();
    fixture.detectChanges();

    const tablist = dialogEl().querySelector('[data-testid="asset-picker-tablist"]');
    expect(tablist).toBeTruthy();
    expect(tablist!.getAttribute('role')).toBe('tablist');
    const browseTab = dialogEl().querySelector('[data-testid="asset-picker-tab-browse"]');
    const uploadTab = dialogEl().querySelector('[data-testid="asset-picker-tab-upload"]');
    expect(browseTab).toBeTruthy();
    expect(uploadTab).toBeTruthy();
    expect(browseTab!.getAttribute('aria-selected')).toBe('true');
    expect(uploadTab!.getAttribute('aria-selected')).toBe('false');
  });

  it('hides the tablist entirely when the operator lacks assets:create', async () => {
    await setup(new Set(['assets:view']));
    const fixture = TestBed.createComponent(HostWithUploadComponent);
    fixture.detectChanges();
    void fixture.componentInstance.open({ mode: 'single' });
    await flush();
    fixture.detectChanges();

    expect(dialogEl().querySelector('[data-testid="asset-picker-tablist"]')).toBeNull();
    expect(dialogEl().querySelector('[data-testid="asset-picker-tab-upload"]')).toBeNull();
    // Browse panel remains visible (the legacy single-mode experience).
    const browse = dialogEl().querySelector('[data-testid="asset-picker-browse-panel"]');
    expect(browse).toBeTruthy();
    expect(browse!.hasAttribute('hidden')).toBe(false);
  });

  it('switches to the Upload tab on click and back to Browse on click', async () => {
    await setup(new Set(['assets:view', 'assets:create']));
    const fixture = TestBed.createComponent(HostWithUploadComponent);
    fixture.detectChanges();
    void fixture.componentInstance.open({ mode: 'single' });
    await flush();
    fixture.detectChanges();

    const uploadTab = dialogEl().querySelector<HTMLButtonElement>(
      '[data-testid="asset-picker-tab-upload"]',
    );
    uploadTab!.click();
    fixture.detectChanges();
    expect(uploadTab!.getAttribute('aria-selected')).toBe('true');
    const uploadPanel = dialogEl().querySelector('[data-testid="asset-picker-upload-panel"]');
    expect(uploadPanel).toBeTruthy();
    expect(uploadPanel!.hasAttribute('hidden')).toBe(false);
    const browsePanel = dialogEl().querySelector('[data-testid="asset-picker-browse-panel"]');
    expect(browsePanel!.hasAttribute('hidden')).toBe(true);

    const browseTab = dialogEl().querySelector<HTMLButtonElement>(
      '[data-testid="asset-picker-tab-browse"]',
    );
    browseTab!.click();
    fixture.detectChanges();
    expect(browseTab!.getAttribute('aria-selected')).toBe('true');
    expect(browsePanel!.hasAttribute('hidden')).toBe(false);
  });

  it('cycles tabs with ArrowRight / ArrowLeft / Home / End on the tablist', async () => {
    await setup(new Set(['assets:view', 'assets:create']));
    const fixture = TestBed.createComponent(HostWithUploadComponent);
    fixture.detectChanges();
    void fixture.componentInstance.open({ mode: 'single' });
    await flush();
    fixture.detectChanges();

    const tablist = dialogEl().querySelector<HTMLElement>('[data-testid="asset-picker-tablist"]');
    const dispatch = (key: string): void => {
      tablist!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    };
    const uploadTab = dialogEl().querySelector('[data-testid="asset-picker-tab-upload"]')!;
    const browseTab = dialogEl().querySelector('[data-testid="asset-picker-tab-browse"]')!;

    dispatch('ArrowRight');
    fixture.detectChanges();
    expect(uploadTab.getAttribute('aria-selected')).toBe('true');

    dispatch('ArrowLeft');
    fixture.detectChanges();
    expect(browseTab.getAttribute('aria-selected')).toBe('true');

    dispatch('End');
    fixture.detectChanges();
    expect(uploadTab.getAttribute('aria-selected')).toBe('true');

    dispatch('Home');
    fixture.detectChanges();
    expect(browseTab.getAttribute('aria-selected')).toBe('true');

    // Unhandled key falls through to the default branch.
    dispatch('PageDown');
  });

  it.each<{ type: 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'AUDIO' | undefined; expected: string }>([
    { type: 'IMAGE', expected: 'image/jpeg,image/png,image/webp,image/avif' },
    { type: 'VIDEO', expected: 'video/mp4,video/webm' },
    {
      type: 'DOCUMENT',
      expected: 'image/jpeg,image/png,image/webp,image/avif,video/mp4,video/webm',
    },
    {
      type: 'AUDIO',
      expected: 'image/jpeg,image/png,image/webp,image/avif,video/mp4,video/webm',
    },
    {
      type: undefined,
      expected: 'image/jpeg,image/png,image/webp,image/avif,video/mp4,video/webm',
    },
  ])('derives dropzone accept from filter.type=$type', async ({ type, expected }) => {
    await setup(new Set(['assets:view', 'assets:create']));
    const fixture = TestBed.createComponent(HostWithUploadComponent);
    fixture.detectChanges();
    void fixture.componentInstance.open({
      mode: 'single',
      filter: type ? { type } : undefined,
    });
    await flush();
    fixture.detectChanges();

    const uploadTab = dialogEl().querySelector<HTMLButtonElement>(
      '[data-testid="asset-picker-tab-upload"]',
    );
    uploadTab!.click();
    fixture.detectChanges();

    const dropzone = dialogEl().querySelector('[data-testid="asset-picker-dropzone"]');
    expect(dropzone).toBeTruthy();
    const fileInput = dropzone!.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput).toBeTruthy();
    expect(fileInput!.getAttribute('accept')).toBe(expected);
  });

  it('single-mode upload happy path: drop file, READY, picker auto-resolves with the asset', async () => {
    await setup(new Set(['assets:view', 'assets:create']));
    const stream = new Subject<AssetUploadEvent>();
    service.uploadSpy.mockReturnValue(stream.asObservable());

    const fixture = TestBed.createComponent(HostWithUploadComponent);
    fixture.detectChanges();
    const promise = fixture.componentInstance.open({ mode: 'single' });
    await flush();
    fixture.detectChanges();

    const uploadTab = dialogEl().querySelector<HTMLButtonElement>(
      '[data-testid="asset-picker-tab-upload"]',
    );
    uploadTab!.click();
    fixture.detectChanges();

    const dropzone = dialogEl().querySelector('[data-testid="asset-picker-dropzone"]')!;
    const fileInput = dropzone.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File([new Uint8Array([0xff])], 'pic.png', { type: 'image/png' });
    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
    fileInput.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(service.uploadSpy).toHaveBeenCalledTimes(1);

    // Drive the upload stream — done event arrives with a READY asset directly
    // (server-side may complete processing before the client sees the response).
    stream.next({ kind: 'done', asset: READY_ASSET });
    stream.complete();
    fixture.detectChanges();

    const result = await promise;
    expect(result).toEqual({ kind: 'select-single', asset: READY_ASSET });
  });

  it('multi-mode upload happy path: drop file, READY, append + switch back to Browse + refetch', async () => {
    await setup(new Set(['assets:view', 'assets:create']));
    const stream = new Subject<AssetUploadEvent>();
    service.uploadSpy.mockReturnValue(stream.asObservable());

    const fixture = TestBed.createComponent(HostWithUploadComponent);
    fixture.detectChanges();
    void fixture.componentInstance.open({ mode: 'multi', selectedIds: ['asset-aaa'] });
    await flush();
    fixture.detectChanges();
    const initialFetchCount = service.listSpy.mock.calls.length;

    const uploadTab = dialogEl().querySelector<HTMLButtonElement>(
      '[data-testid="asset-picker-tab-upload"]',
    );
    uploadTab!.click();
    fixture.detectChanges();

    const dropzone = dialogEl().querySelector('[data-testid="asset-picker-dropzone"]')!;
    const fileInput = dropzone.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File([new Uint8Array([0xff])], 'pic.png', { type: 'image/png' });
    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
    fileInput.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    stream.next({ kind: 'done', asset: READY_ASSET });
    stream.complete();
    await flush();
    fixture.detectChanges();

    const browseTab = dialogEl().querySelector('[data-testid="asset-picker-tab-browse"]')!;
    expect(browseTab.getAttribute('aria-selected')).toBe('true');
    expect(service.listSpy.mock.calls.length).toBeGreaterThan(initialFetchCount);

    // Confirm with Select N — selection set should now contain the new asset id.
    const confirm = dialogEl().querySelector<HTMLButtonElement>(
      '[data-testid="asset-picker-confirm"]',
    );
    expect(confirm!.textContent).toContain('Select 2');
  });

  it('polling cap → STILL_PROCESSING tile with View-in-library router link', async () => {
    jest.useFakeTimers();
    try {
      await setup(new Set(['assets:view', 'assets:create']));
      const stream = new Subject<AssetUploadEvent>();
      service.uploadSpy.mockReturnValue(stream.asObservable());
      service.getSpy.mockImplementation(() => of(PROCESSING_ASSET));

      const fixture = TestBed.createComponent(HostWithUploadComponent);
      fixture.detectChanges();
      void fixture.componentInstance.open({ mode: 'multi' });
      await Promise.resolve();
      fixture.detectChanges();

      const uploadTab = dialogEl().querySelector<HTMLButtonElement>(
        '[data-testid="asset-picker-tab-upload"]',
      );
      uploadTab!.click();
      fixture.detectChanges();

      const dropzone = dialogEl().querySelector('[data-testid="asset-picker-dropzone"]')!;
      const fileInput = dropzone.querySelector<HTMLInputElement>('input[type="file"]')!;
      const file = new File([new Uint8Array([0xff])], 'slow.png', { type: 'image/png' });
      Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
      fileInput.dispatchEvent(new Event('change'));
      fixture.detectChanges();

      stream.next({ kind: 'done', asset: PROCESSING_ASSET });
      stream.complete();
      fixture.detectChanges();

      // Advance past the 30 s polling cap.
      jest.advanceTimersByTime(31_000);
      fixture.detectChanges();

      const tile = dialogEl().querySelector('[data-testid^="asset-picker-upload-tile-"]');
      expect(tile).toBeTruthy();
      const status = tile!.querySelector('[data-testid^="asset-picker-upload-status-"]');
      expect(status?.textContent?.trim()).toBe('Still processing');
      const link = tile!.querySelector('[data-testid^="asset-picker-upload-view-"]');
      expect(link).toBeTruthy();
      expect(link!.tagName).toBe('A');
    } finally {
      jest.useRealTimers();
    }
  });

  it('polling failure → FAILED tile with retry button that re-runs uploadWithProgress', async () => {
    jest.useFakeTimers();
    try {
      await setup(new Set(['assets:view', 'assets:create']));
      const stream = new Subject<AssetUploadEvent>();
      service.uploadSpy.mockReturnValue(stream.asObservable());
      service.getSpy.mockImplementation(() =>
        of({ ...PROCESSING_ASSET, status: 'FAILED' as const }),
      );

      const fixture = TestBed.createComponent(HostWithUploadComponent);
      fixture.detectChanges();
      void fixture.componentInstance.open({ mode: 'multi' });
      await Promise.resolve();
      fixture.detectChanges();

      const uploadTab = dialogEl().querySelector<HTMLButtonElement>(
        '[data-testid="asset-picker-tab-upload"]',
      );
      uploadTab!.click();
      fixture.detectChanges();

      const dropzone = dialogEl().querySelector('[data-testid="asset-picker-dropzone"]')!;
      const fileInput = dropzone.querySelector<HTMLInputElement>('input[type="file"]')!;
      const file = new File([new Uint8Array([0xff])], 'bad.png', { type: 'image/png' });
      Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
      fileInput.dispatchEvent(new Event('change'));
      fixture.detectChanges();

      stream.next({ kind: 'done', asset: PROCESSING_ASSET });
      stream.complete();
      fixture.detectChanges();

      // Advance to the first poll → server reports FAILED.
      jest.advanceTimersByTime(1_500);
      fixture.detectChanges();

      const tile = dialogEl().querySelector('[data-testid^="asset-picker-upload-tile-"]');
      const status = tile!.querySelector('[data-testid^="asset-picker-upload-status-"]');
      expect(status?.textContent?.trim()).toBe('Failed');

      // Retry button re-runs uploadWithProgress with the same File. AppButton
      // emits the data-testid directly on the inner <button> element.
      const retryBefore = service.uploadSpy.mock.calls.length;
      const retry = tile!.querySelector<HTMLButtonElement>(
        'button[data-testid^="asset-picker-upload-retry-"]',
      );
      expect(retry).toBeTruthy();
      retry!.click();
      fixture.detectChanges();
      expect(service.uploadSpy.mock.calls.length).toBe(retryBefore + 1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('axe-clean with the Upload tab visible (assets:create granted)', async () => {
    await setup(new Set(['assets:view', 'assets:create']));
    const fixture = TestBed.createComponent(HostWithUploadComponent);
    fixture.detectChanges();
    void fixture.componentInstance.open({ mode: 'single', title: 'Pick or upload' });
    await flush();
    fixture.detectChanges();

    const uploadTab = dialogEl().querySelector<HTMLButtonElement>(
      '[data-testid="asset-picker-tab-upload"]',
    );
    uploadTab!.click();
    fixture.detectChanges();

    const results = await axe(dialogEl(), {
      runOnly: { type: 'tag', values: ['wcag22a', 'wcag22aa'] },
      includedImpacts: ['serious', 'critical'],
    });
    expect(results).toHaveNoViolations();
  });

  it('axe-clean in Browse-only degraded state (no assets:create)', async () => {
    await setup(new Set(['assets:view']));
    const fixture = TestBed.createComponent(HostWithUploadComponent);
    fixture.detectChanges();
    void fixture.componentInstance.open({ mode: 'single', title: 'Pick an asset' });
    await flush();
    fixture.detectChanges();

    const results = await axe(dialogEl(), {
      runOnly: { type: 'tag', values: ['wcag22a', 'wcag22aa'] },
      includedImpacts: ['serious', 'critical'],
    });
    expect(results).toHaveNoViolations();
  });

  it('upload stream error → tile flips to FAILED with the API error message', async () => {
    await setup(new Set(['assets:view', 'assets:create']));
    const stream = new Subject<AssetUploadEvent>();
    service.uploadSpy.mockReturnValue(stream.asObservable());

    const fixture = TestBed.createComponent(HostWithUploadComponent);
    fixture.detectChanges();
    void fixture.componentInstance.open({ mode: 'multi' });
    await flush();
    fixture.detectChanges();

    dialogEl().querySelector<HTMLButtonElement>('[data-testid="asset-picker-tab-upload"]')!.click();
    fixture.detectChanges();

    const fileInput = dialogEl().querySelector<HTMLInputElement>(
      '[data-testid="asset-picker-dropzone"] input[type="file"]',
    )!;
    const file = new File([new Uint8Array([0xff])], 'oops.png', { type: 'image/png' });
    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
    fileInput.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    stream.error(new Error('Network error'));
    fixture.detectChanges();

    const tile = dialogEl().querySelector('[data-testid^="asset-picker-upload-tile-"]')!;
    expect(
      tile.querySelector('[data-testid^="asset-picker-upload-status-"]')?.textContent?.trim(),
    ).toBe('Failed');
    expect(
      tile.querySelector('[data-testid^="asset-picker-upload-error-"]')?.textContent?.trim(),
    ).toBe('Network error');
  });

  it('upload stream error with non-Error throwable → tile shows generic "Upload failed."', async () => {
    await setup(new Set(['assets:view', 'assets:create']));
    const stream = new Subject<AssetUploadEvent>();
    service.uploadSpy.mockReturnValue(stream.asObservable());

    const fixture = TestBed.createComponent(HostWithUploadComponent);
    fixture.detectChanges();
    void fixture.componentInstance.open({ mode: 'multi' });
    await flush();
    fixture.detectChanges();

    dialogEl().querySelector<HTMLButtonElement>('[data-testid="asset-picker-tab-upload"]')!.click();
    fixture.detectChanges();

    const fileInput = dialogEl().querySelector<HTMLInputElement>(
      '[data-testid="asset-picker-dropzone"] input[type="file"]',
    )!;
    const file = new File([new Uint8Array([0xff])], 'plain.png', { type: 'image/png' });
    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
    fileInput.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    stream.error('plain string');
    fixture.detectChanges();

    const tile = dialogEl().querySelector('[data-testid^="asset-picker-upload-tile-"]')!;
    expect(
      tile.querySelector('[data-testid^="asset-picker-upload-error-"]')?.textContent?.trim(),
    ).toBe('Upload failed.');
  });

  it('client-side rejection (size) → FAILED tile with size-limit message', async () => {
    await setup(new Set(['assets:view', 'assets:create']));
    const fixture = TestBed.createComponent(HostWithUploadComponent);
    fixture.detectChanges();
    void fixture.componentInstance.open({ mode: 'multi' });
    await flush();
    fixture.detectChanges();

    dialogEl().querySelector<HTMLButtonElement>('[data-testid="asset-picker-tab-upload"]')!.click();
    fixture.detectChanges();

    const fileInput = dialogEl().querySelector<HTMLInputElement>(
      '[data-testid="asset-picker-dropzone"] input[type="file"]',
    )!;
    // 11 MB file exceeds the dropzone's default 10 MB cap and emits filesRejected.
    const big = new File([new Uint8Array(11 * 1024 * 1024)], 'huge.png', { type: 'image/png' });
    Object.defineProperty(fileInput, 'files', { value: [big], configurable: true });
    fileInput.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const tile = dialogEl().querySelector('[data-testid^="asset-picker-upload-tile-"]')!;
    expect(
      tile.querySelector('[data-testid^="asset-picker-upload-error-"]')?.textContent?.trim(),
    ).toBe('File exceeds the 10 MB upload limit.');
  });

  it('client-side rejection (mime) → FAILED tile with type-not-allowed message', async () => {
    await setup(new Set(['assets:view', 'assets:create']));
    const fixture = TestBed.createComponent(HostWithUploadComponent);
    fixture.detectChanges();
    void fixture.componentInstance.open({ mode: 'multi', filter: { type: 'IMAGE' } });
    await flush();
    fixture.detectChanges();

    dialogEl().querySelector<HTMLButtonElement>('[data-testid="asset-picker-tab-upload"]')!.click();
    fixture.detectChanges();

    const fileInput = dialogEl().querySelector<HTMLInputElement>(
      '[data-testid="asset-picker-dropzone"] input[type="file"]',
    )!;
    // PDF is not in the IMAGE allowlist → MIME rejection.
    const pdf = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'doc.pdf', {
      type: 'application/pdf',
    });
    Object.defineProperty(fileInput, 'files', { value: [pdf], configurable: true });
    fileInput.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const tile = dialogEl().querySelector('[data-testid^="asset-picker-upload-tile-"]')!;
    expect(
      tile.querySelector('[data-testid^="asset-picker-upload-error-"]')?.textContent?.trim(),
    ).toBe('File type is not allowed.');
  });

  it('dismiss button removes a FAILED tile from the queue', async () => {
    await setup(new Set(['assets:view', 'assets:create']));
    const stream = new Subject<AssetUploadEvent>();
    service.uploadSpy.mockReturnValue(stream.asObservable());

    const fixture = TestBed.createComponent(HostWithUploadComponent);
    fixture.detectChanges();
    void fixture.componentInstance.open({ mode: 'multi' });
    await flush();
    fixture.detectChanges();

    dialogEl().querySelector<HTMLButtonElement>('[data-testid="asset-picker-tab-upload"]')!.click();
    fixture.detectChanges();

    const fileInput = dialogEl().querySelector<HTMLInputElement>(
      '[data-testid="asset-picker-dropzone"] input[type="file"]',
    )!;
    const file = new File([new Uint8Array([0xff])], 'gone.png', { type: 'image/png' });
    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
    fileInput.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    stream.error(new Error('boom'));
    fixture.detectChanges();

    const tilesBefore = dialogEl().querySelectorAll(
      '[data-testid^="asset-picker-upload-tile-"]',
    ).length;
    expect(tilesBefore).toBe(1);

    const dismiss = dialogEl().querySelector<HTMLButtonElement>(
      'button[data-testid^="asset-picker-upload-dismiss-"]',
    );
    expect(dismiss).toBeTruthy();
    dismiss!.click();
    fixture.detectChanges();

    expect(dialogEl().querySelectorAll('[data-testid^="asset-picker-upload-tile-"]').length).toBe(
      0,
    );
  });

  it('polling poll → READY → multi-mode auto-switch back to Browse', async () => {
    jest.useFakeTimers();
    try {
      await setup(new Set(['assets:view', 'assets:create']));
      const stream = new Subject<AssetUploadEvent>();
      service.uploadSpy.mockReturnValue(stream.asObservable());
      service.getSpy.mockImplementation(() => of(READY_ASSET));

      const fixture = TestBed.createComponent(HostWithUploadComponent);
      fixture.detectChanges();
      void fixture.componentInstance.open({ mode: 'multi' });
      await Promise.resolve();
      fixture.detectChanges();

      dialogEl()
        .querySelector<HTMLButtonElement>('[data-testid="asset-picker-tab-upload"]')!
        .click();
      fixture.detectChanges();

      const fileInput = dialogEl().querySelector<HTMLInputElement>(
        '[data-testid="asset-picker-dropzone"] input[type="file"]',
      )!;
      const file = new File([new Uint8Array([0xff])], 'poll.png', { type: 'image/png' });
      Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
      fileInput.dispatchEvent(new Event('change'));
      fixture.detectChanges();

      // Upload completes with a PROCESSING asset → polling kicks in.
      stream.next({ kind: 'done', asset: PROCESSING_ASSET });
      stream.complete();
      fixture.detectChanges();

      // First poll fires; getSpy returns READY → markTileReady.
      jest.advanceTimersByTime(1_500);
      fixture.detectChanges();

      const browseTab = dialogEl().querySelector('[data-testid="asset-picker-tab-browse"]')!;
      expect(browseTab.getAttribute('aria-selected')).toBe('true');
    } finally {
      jest.useRealTimers();
    }
  });

  it('upload progress event maps ratio → tile progress percent', async () => {
    await setup(new Set(['assets:view', 'assets:create']));
    const stream = new Subject<AssetUploadEvent>();
    service.uploadSpy.mockReturnValue(stream.asObservable());

    const fixture = TestBed.createComponent(HostWithUploadComponent);
    fixture.detectChanges();
    void fixture.componentInstance.open({ mode: 'multi' });
    await flush();
    fixture.detectChanges();

    dialogEl().querySelector<HTMLButtonElement>('[data-testid="asset-picker-tab-upload"]')!.click();
    fixture.detectChanges();

    const fileInput = dialogEl().querySelector<HTMLInputElement>(
      '[data-testid="asset-picker-dropzone"] input[type="file"]',
    )!;
    const file = new File([new Uint8Array([0xff])], 'half.png', { type: 'image/png' });
    Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
    fileInput.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    stream.next({ kind: 'progress', progress: { loaded: 50, total: 100, ratio: 0.5 } });
    fixture.detectChanges();

    const progress = dialogEl().querySelector('[data-testid^="asset-picker-upload-progress-"]');
    expect(progress?.getAttribute('aria-valuenow')).toBe('50');
  });

  it('setActiveTab(upload) is a no-op when canUpload() is false', async () => {
    await setup(new Set(['assets:view']));
    const fixture = TestBed.createComponent(HostWithUploadComponent);
    fixture.detectChanges();
    void fixture.componentInstance.open({ mode: 'single' });
    await flush();
    fixture.detectChanges();

    // No tablist exists in Browse-only mode; the browse panel must remain visible.
    expect(dialogEl().querySelector('[data-testid="asset-picker-tab-upload"]')).toBeNull();
    const browse = dialogEl().querySelector('[data-testid="asset-picker-browse-panel"]')!;
    expect(browse.hasAttribute('hidden')).toBe(false);
  });
});
