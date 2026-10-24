import { ComponentFixture, TestBed } from '@angular/core/testing';
import { axe, toHaveNoViolations } from 'jest-axe';
import type { SeoQuota } from '@admin-services';
import { SeoQuotaReadoutComponent } from './seo-quota-readout.component';

expect.extend(toHaveNoViolations);

const QUOTA: SeoQuota = {
  bing: { state: 'ok', detail: 'live', dailyQuota: 5, monthlyQuota: 120 },
  gsc: {
    state: 'ok',
    detail: '37/2000 used (estimated)',
    inspectUsed: 37,
    inspectCap: 2000,
    source: 'estimated',
  },
  indexnow: { dedupWindowSeconds: 300 },
};

describe('SeoQuotaReadoutComponent', () => {
  let fixture: ComponentFixture<SeoQuotaReadoutComponent>;

  const setup = (inputs: Record<string, unknown> = {}) => {
    fixture = TestBed.createComponent(SeoQuotaReadoutComponent);
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  beforeEach(() => TestBed.configureTestingModule({ imports: [SeoQuotaReadoutComponent] }));

  it('shows the live Bing quota verbatim (adaptive single-digit value)', () => {
    const el = setup({ quota: QUOTA });
    const cells = el.querySelector('[data-testid="seo-quota-cells"]')!;
    expect(cells.textContent).toContain('5');
    expect(cells.textContent).toContain('120');
  });

  it('shows the GSC inspect budget used/cap', () => {
    const el = setup({ quota: QUOTA });
    expect(el.textContent).toContain('37');
    expect(el.textContent).toContain('2000');
    expect(el.textContent).toMatch(/estimated/i);
  });

  it('renders the IndexNow dedup window in minutes', () => {
    const el = setup({ quota: QUOTA });
    expect(el.textContent).toMatch(/5\s*min dedup window/i);
  });

  it('shows the degrade detail for a disabled Bing engine', () => {
    const el = setup({
      quota: {
        bing: {
          state: 'disabled',
          detail: 'BING_API_KEY unset',
          dailyQuota: null,
          monthlyQuota: null,
        },
        gsc: {
          state: 'disabled',
          detail: 'GSC disabled',
          inspectUsed: 0,
          inspectCap: 2000,
          source: 'estimated',
        },
        indexnow: { dedupWindowSeconds: 300 },
      },
    });
    expect(el.textContent).toContain('BING_API_KEY unset');
    expect(el.textContent).toContain('GSC disabled');
  });

  it('shows the error detail when an engine quota probe errored', () => {
    const el = setup({
      quota: {
        bing: {
          state: 'error',
          detail: 'GetUrlSubmissionQuota returned 500',
          dailyQuota: null,
          monthlyQuota: null,
        },
        gsc: {
          state: 'error',
          detail: 'GSC 503',
          inspectUsed: 0,
          inspectCap: 2000,
          source: 'estimated',
        },
        indexnow: { dedupWindowSeconds: 300 },
      },
    });
    expect(el.textContent).toContain('GetUrlSubmissionQuota returned 500');
    expect(el.textContent).toContain('GSC 503');
  });

  it('renders the unavailable fallback when quota is null', () => {
    const el = setup({ quota: null });
    expect(el.querySelector('[data-testid="seo-quota-empty"]')).not.toBeNull();
  });

  it('is axe-clean', async () => {
    const el = setup({ quota: QUOTA });
    expect(await axe(el)).toHaveNoViolations();
  });

  it('is axe-clean while loading', async () => {
    const el = setup({ loading: true });
    expect(await axe(el)).toHaveNoViolations();
  });
});
