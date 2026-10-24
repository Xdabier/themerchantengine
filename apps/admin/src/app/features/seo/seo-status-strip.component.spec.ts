import { ComponentFixture, TestBed } from '@angular/core/testing';
import { axe, toHaveNoViolations } from 'jest-axe';
import type { SubmissionHealth } from '@admin-services';
import { SeoStatusStripComponent } from './seo-status-strip.component';

expect.extend(toHaveNoViolations);

const HEALTH: SubmissionHealth = {
  checkedAt: '2026-06-28T09:00:00.000Z',
  healthy: false,
  gsc: { state: 'ok', detail: 'lastDownloaded=2026-06-27' },
  bing: { state: 'disabled', detail: 'BING_API_KEY unset' },
  publicSitemap: { state: 'error', detail: 'HTTP 502' },
};

describe('SeoStatusStripComponent', () => {
  let fixture: ComponentFixture<SeoStatusStripComponent>;

  const setup = (inputs: Record<string, unknown> = {}) => {
    fixture = TestBed.createComponent(SeoStatusStripComponent);
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  beforeEach(() => TestBed.configureTestingModule({ imports: [SeoStatusStripComponent] }));

  it('renders a cell per engine with the mapped state label', () => {
    const el = setup({ health: HEALTH });
    const cells = el.querySelector('[data-testid="seo-status-cells"]')!;
    expect(cells.textContent).toContain('Google');
    expect(cells.textContent).toContain('OK');
    expect(cells.textContent).toContain('Disabled');
    expect(cells.textContent).toContain('Error');
  });

  it('shows the no-probe message when health is null', () => {
    const el = setup({ health: null });
    expect(el.querySelector('[data-testid="seo-status-checked-at"]')!.textContent).toMatch(
      /no health probe/i,
    );
  });

  it('hides the re-check button without seo:manage', () => {
    const el = setup({ health: HEALTH, canManage: false });
    expect(el.querySelector('[data-testid="seo-status-recheck"]')).toBeNull();
  });

  it('shows + emits recheck when manage is granted', () => {
    const el = setup({ health: HEALTH, canManage: true });
    const cmp = fixture.componentInstance;
    const spy = jest.fn();
    cmp.recheck.subscribe(spy);
    const btn = el.querySelector('[data-testid="seo-status-recheck"]') as HTMLElement;
    expect(btn).not.toBeNull();
    btn.querySelector('button')!.click();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('disables the button while rechecking', () => {
    const el = setup({ health: HEALTH, canManage: true, rechecking: true });
    const btn = el.querySelector('[data-testid="seo-status-recheck"] button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('is axe-clean', async () => {
    const el = setup({ health: HEALTH, canManage: true });
    expect(await axe(el)).toHaveNoViolations();
  });

  it('is axe-clean in the loading state', async () => {
    const el = setup({ loading: true });
    expect(await axe(el)).toHaveNoViolations();
  });
});
