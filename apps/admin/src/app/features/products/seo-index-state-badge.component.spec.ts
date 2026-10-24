import { ComponentFixture, TestBed } from '@angular/core/testing';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, Subject, throwError } from 'rxjs';
import { SeoService, type SeoUrlInspection } from '@admin-services';
import { ApiError, ApiForbiddenError } from '@admin-types';
import { SeoIndexStateBadgeComponent } from './seo-index-state-badge.component';

expect.extend(toHaveNoViolations);

const baseNulls = {
  detail: '',
  url: null,
  verdict: null,
  coverageState: null,
  indexingState: null,
  robotsTxtState: null,
  pageFetchState: null,
  lastCrawlTime: null,
  googleCanonical: null,
  userCanonical: null,
  inspectUsed: null,
  inspectCap: null,
};

const okInspection: SeoUrlInspection = {
  ...baseNulls,
  state: 'ok',
  detail: 'PASS',
  url: 'https://demo.example/fr/catalogue/produit/fraise-dentaire',
  verdict: 'PASS',
  coverageState: 'Submitted and indexed',
  indexingState: 'INDEXING_ALLOWED',
  robotsTxtState: 'ALLOWED',
  pageFetchState: 'SUCCESSFUL',
  lastCrawlTime: '2026-06-27T10:00:00.000Z',
  googleCanonical: 'https://demo.example/fr/catalogue/produit/fraise-dentaire',
  userCanonical: 'https://demo.example/fr/catalogue/produit/fraise-dentaire',
};

describe('SeoIndexStateBadgeComponent', () => {
  let fixture: ComponentFixture<SeoIndexStateBadgeComponent>;
  let inspectUrl: jest.Mock;

  const setup = () => {
    fixture = TestBed.createComponent(SeoIndexStateBadgeComponent);
    fixture.componentRef.setInput('productId', 'prod-1');
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  const clickCheck = (el: HTMLElement) => {
    el.querySelector<HTMLButtonElement>('[data-testid="seo-index-state-check"] button')!.click();
    fixture.detectChanges();
  };

  beforeEach(() => {
    inspectUrl = jest.fn();
    TestBed.configureTestingModule({
      imports: [SeoIndexStateBadgeComponent],
      providers: [{ provide: SeoService, useValue: { inspectUrl } }],
    });
  });

  it('renders the trigger button and fires NO request on init', () => {
    const el = setup();
    expect(el.querySelector('[data-testid="seo-index-state-check"]')).not.toBeNull();
    expect(inspectUrl).not.toHaveBeenCalled();
    expect(el.querySelector('[data-testid="seo-index-state-detail"]')).toBeNull();
    expect(el.querySelector('[data-testid="seo-index-state-verdict"]')).toBeNull();
  });

  it('idle state is axe-clean', async () => {
    const el = setup();
    expect(await axe(el)).toHaveNoViolations();
  });

  it('shows aria-busy while the inspection is in flight', () => {
    inspectUrl.mockReturnValue(new Subject<SeoUrlInspection>()); // never emits
    const el = setup();
    clickCheck(el);
    expect(el.querySelector('[data-testid="seo-index-state"]')!.getAttribute('aria-busy')).toBe(
      'true',
    );
  });

  it('loading state is axe-clean', async () => {
    inspectUrl.mockReturnValue(new Subject<SeoUrlInspection>());
    const el = setup();
    clickCheck(el);
    expect(await axe(el)).toHaveNoViolations();
  });

  it('renders the verdict badge + detail fields on an ok result', () => {
    inspectUrl.mockReturnValue(of(okInspection));
    const el = setup();
    clickCheck(el);
    expect(inspectUrl).toHaveBeenCalledWith({ productId: 'prod-1' });
    expect(el.querySelector('[data-testid="seo-index-state-verdict"]')!.textContent).toContain(
      'Pass',
    );
    const detail = el.querySelector('[data-testid="seo-index-state-detail"]')!;
    expect(detail.textContent).toContain('Submitted and indexed');
    expect(detail.textContent).toContain('2026-06-27T10:00:00.000Z');
    expect(el.textContent!.toLowerCase()).not.toContain('reindex');
  });

  it('ok state is axe-clean', async () => {
    inspectUrl.mockReturnValue(of(okInspection));
    const el = setup();
    clickCheck(el);
    expect(await axe(el)).toHaveNoViolations();
  });

  it('renders the disabled degrade copy', () => {
    inspectUrl.mockReturnValue(
      of({ ...baseNulls, state: 'disabled', detail: 'GSC disabled' } as SeoUrlInspection),
    );
    const el = setup();
    clickCheck(el);
    expect(el.querySelector('[data-testid="seo-index-state-disabled"]')!.textContent).toContain(
      'Search Console is not connected',
    );
    expect(el.querySelector('[data-testid="seo-index-state-verdict"]')).toBeNull();
    expect(el.textContent!.toLowerCase()).not.toContain('reindex');
  });

  it('disabled state is axe-clean', async () => {
    inspectUrl.mockReturnValue(
      of({ ...baseNulls, state: 'disabled', detail: 'GSC disabled' } as SeoUrlInspection),
    );
    const el = setup();
    clickCheck(el);
    expect(await axe(el)).toHaveNoViolations();
  });

  it('renders the error degrade copy', () => {
    inspectUrl.mockReturnValue(
      of({ ...baseNulls, state: 'error', detail: 'GSC returned 403' } as SeoUrlInspection),
    );
    const el = setup();
    clickCheck(el);
    const err = el.querySelector('[data-testid="seo-index-state-error"]')!;
    expect(err.getAttribute('role')).toBe('alert');
    expect(err.textContent).toContain('Could not read the index state');
    expect(el.textContent!.toLowerCase()).not.toContain('reindex');
  });

  it('error state is axe-clean', async () => {
    inspectUrl.mockReturnValue(
      of({ ...baseNulls, state: 'error', detail: 'GSC returned 403' } as SeoUrlInspection),
    );
    const el = setup();
    clickCheck(el);
    expect(await axe(el)).toHaveNoViolations();
  });

  it('renders the exhausted budget copy with used/cap', () => {
    inspectUrl.mockReturnValue(
      of({
        ...baseNulls,
        state: 'exhausted',
        detail: 'budget reached',
        inspectUsed: 2000,
        inspectCap: 2000,
      } as SeoUrlInspection),
    );
    const el = setup();
    clickCheck(el);
    const ex = el.querySelector('[data-testid="seo-index-state-exhausted"]')!;
    expect(ex.textContent).toContain('Daily inspection budget reached');
    expect(ex.textContent).toContain('2000/2000');
    expect(el.querySelector('[data-testid="seo-index-state-verdict"]')).toBeNull();
  });

  it('exhausted state is axe-clean', async () => {
    inspectUrl.mockReturnValue(
      of({
        ...baseNulls,
        state: 'exhausted',
        detail: 'budget reached',
        inspectUsed: 2000,
        inspectCap: 2000,
      } as SeoUrlInspection),
    );
    const el = setup();
    clickCheck(el);
    expect(await axe(el)).toHaveNoViolations();
  });

  it('an ok result with all-null verdict fields renders dashes, never [object Object]', () => {
    inspectUrl.mockReturnValue(
      of({ ...baseNulls, state: 'ok', detail: 'inspected' } as SeoUrlInspection),
    );
    const el = setup();
    clickCheck(el);
    expect(el.textContent).not.toContain('[object Object]');
    expect(el.textContent).not.toContain('undefined');
    expect(el.querySelector('[data-testid="seo-index-state-detail"]')!.textContent).toContain('—');
    // Null verdict → neutral "Unknown" badge, not a thrown error.
    expect(el.querySelector('[data-testid="seo-index-state-verdict"]')!.textContent).toContain(
      'Unknown',
    );
  });

  it('null-field ok state is axe-clean', async () => {
    inspectUrl.mockReturnValue(
      of({ ...baseNulls, state: 'ok', detail: 'inspected' } as SeoUrlInspection),
    );
    const el = setup();
    clickCheck(el);
    expect(await axe(el)).toHaveNoViolations();
  });

  it('surfaces a forbidden transport error without leaking a stack trace', () => {
    inspectUrl.mockReturnValue(throwError(() => new ApiForbiddenError('nope')));
    const el = setup();
    clickCheck(el);
    const err = el.querySelector('[data-testid="seo-index-state-http-error"]')!;
    expect(err.textContent).toContain('You do not have permission');
    // A transport error shows no verdict badge or detail grid.
    expect(el.querySelector('[data-testid="seo-index-state-verdict"]')).toBeNull();
    expect(el.querySelector('[data-testid="seo-index-state-detail"]')).toBeNull();
  });

  it('formats a generic ApiError as its message', () => {
    inspectUrl.mockReturnValue(
      throwError(() => new ApiError({ code: 'ERR', message: 'Service unavailable.', status: 503 })),
    );
    const el = setup();
    clickCheck(el);
    expect(el.querySelector('[data-testid="seo-index-state-http-error"]')!.textContent).toContain(
      'Service unavailable.',
    );
  });

  it('formats an unknown transport error with the fallback copy', () => {
    inspectUrl.mockReturnValue(throwError(() => new Error('network')));
    const el = setup();
    clickCheck(el);
    expect(el.querySelector('[data-testid="seo-index-state-http-error"]')!.textContent).toContain(
      'Could not read the index state. Please retry.',
    );
  });

  it('transport-error (httpError) state is axe-clean', async () => {
    inspectUrl.mockReturnValue(throwError(() => new ApiForbiddenError('nope')));
    const el = setup();
    clickCheck(el);
    expect(await axe(el)).toHaveNoViolations();
  });

  it('renders the warning-tone Partial verdict', () => {
    inspectUrl.mockReturnValue(
      of({ ...okInspection, verdict: 'PARTIAL', coverageState: 'Discovered, not indexed' }),
    );
    const el = setup();
    clickCheck(el);
    expect(el.querySelector('[data-testid="seo-index-state-verdict"]')!.textContent).toContain(
      'Partial',
    );
  });

  it('renders the error-tone Fail verdict', () => {
    inspectUrl.mockReturnValue(of({ ...okInspection, verdict: 'FAIL', coverageState: 'Excluded' }));
    const el = setup();
    clickCheck(el);
    expect(el.querySelector('[data-testid="seo-index-state-verdict"]')!.textContent).toContain(
      'Fail',
    );
  });

  it('announces a completed ok inspection via the polite status region', () => {
    inspectUrl.mockReturnValue(of(okInspection));
    const el = setup();
    expect(el.querySelector('[data-testid="seo-index-state-status"]')!.textContent!.trim()).toBe(
      '',
    );
    clickCheck(el);
    expect(el.querySelector('[data-testid="seo-index-state-status"]')!.textContent).toContain(
      'Index state: Pass',
    );
  });

  it('announces a disabled outcome via the polite status region', () => {
    inspectUrl.mockReturnValue(
      of({ ...baseNulls, state: 'disabled', detail: 'GSC disabled' } as SeoUrlInspection),
    );
    const el = setup();
    clickCheck(el);
    expect(el.querySelector('[data-testid="seo-index-state-status"]')!.textContent).toContain(
      'Search Console is not connected',
    );
  });
});
