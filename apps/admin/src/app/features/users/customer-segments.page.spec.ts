import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ApiError, ApiForbiddenError } from '@admin-types';
import { UsersService } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { Subject, of, throwError } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { CustomerSegmentsPage } from './customer-segments.page';

expect.extend(toHaveNoViolations);

const SEGMENTS = ['LOYAL', 'ACTIVE', 'NEW', 'AT_RISK', 'CHURNED'] as const;

describe('CustomerSegmentsPage', () => {
  let fixture: ComponentFixture<CustomerSegmentsPage>;
  let page: CustomerSegmentsPage;
  let segmentsSpy: jest.Mock;

  function configure() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        { provide: UsersService, useValue: { listCustomerSegments: segmentsSpy } },
      ],
    });
    TestBed.inject(AuthStore).setSession({
      user: { id: 'u', email: 'a@b', permissions: ['customers:view'], roles: [], status: 'active' },
    });
    fixture = TestBed.createComponent(CustomerSegmentsPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    segmentsSpy = jest.fn(() =>
      of([
        { segment: 'LOYAL', count: 5 },
        { segment: 'ACTIVE', count: 120 },
      ]),
    );
  });

  it('renders a card for every canonical segment even when backend omits some', () => {
    configure();
    const host = fixture.nativeElement as HTMLElement;
    for (const s of SEGMENTS) {
      expect(host.querySelector(`[data-testid="segment-card-${s}"]`)).toBeTruthy();
    }
    expect(host.querySelector('[data-testid="segment-count-LOYAL"]')?.textContent).toContain('5');
    expect(host.querySelector('[data-testid="segment-count-ACTIVE"]')?.textContent).toContain(
      '120',
    );
    expect(host.querySelector('[data-testid="segment-count-CHURNED"]')?.textContent).toContain('0');
  });

  it('offers no VIP or HIGH_VALUE card, since neither cohort is ever computed', () => {
    configure();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('[data-testid="segment-card-VIP"]')).toBeNull();
    expect(host.querySelector('[data-testid="segment-card-HIGH_VALUE"]')).toBeNull();
  });

  it('titles each card with its cohort, not the constant word "Segment"', () => {
    configure();
    const host = fixture.nativeElement as HTMLElement;
    const heading = host.querySelector('[data-testid="segment-heading-AT_RISK"]');
    expect(heading?.tagName).toBe('H2');
    expect(heading?.textContent?.trim()).toBe('At Risk');
    expect(host.textContent).not.toMatch(/>\s*Segment\s*</);
  });

  it('card link resolves to /customers?segment=<SEGMENT>', () => {
    configure();
    const host = fixture.nativeElement as HTMLElement;
    const link = host.querySelector('[data-testid="segment-link-LOYAL"]') as HTMLAnchorElement;
    const href = link.getAttribute('href');
    expect(href).toContain('/customers');
    expect(href).toContain('segment=LOYAL');
  });

  it('shows skeletons while the observable is pending', () => {
    const subject = new Subject<never>();
    segmentsSpy = jest.fn(() => subject.asObservable());
    configure();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('[role="status"]')).toBeTruthy();
    expect(host.querySelectorAll('[data-testid^="segment-card-"]').length).toBe(0);
  });

  it('403 surfaces a permission-safe error in the role=alert region', () => {
    segmentsSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'Forbidden' })),
    );
    configure();
    expect(page.error()).toContain('permission');
    const host = fixture.nativeElement as HTMLElement;
    const alert = host.querySelector('[data-testid="customer-segments-error"]');
    expect(alert?.textContent).toContain('permission');
  });

  it('non-403 error surfaces a visible banner', () => {
    segmentsSpy = jest.fn(() =>
      throwError(
        () => new ApiError({ code: 'INTERNAL_SERVER_ERROR', message: 'Server error', status: 500 }),
      ),
    );
    configure();
    expect(page.error()).toBeTruthy();
    expect(page.error()).toContain('Server error');
  });

  it('has no axe violations in the loaded state', async () => {
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations in the loading state', async () => {
    const subject = new Subject<never>();
    segmentsSpy = jest.fn(() => subject.asObservable());
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations in the error state', async () => {
    segmentsSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'Forbidden' })),
    );
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });
});
