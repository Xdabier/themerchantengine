import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { SearchAdminService } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { ZeroResultsPage } from './zero-results.page';

expect.extend(toHaveNoViolations);

describe('ZeroResultsPage', () => {
  let fixture: ComponentFixture<ZeroResultsPage>;
  let page: ZeroResultsPage;
  let zeroResultsSpy: jest.Mock;
  let queryParams$: BehaviorSubject<Record<string, string>>;
  let router: Router;

  function configure(params: Record<string, string> = {}) {
    queryParams$ = new BehaviorSubject<Record<string, string>>(params);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        { provide: SearchAdminService, useValue: { zeroResults: zeroResultsSpy } },
        { provide: ActivatedRoute, useValue: { queryParams: queryParams$.asObservable() } },
      ],
    });
    fixture = TestBed.createComponent(ZeroResultsPage);
    page = fixture.componentInstance;
    router = TestBed.inject(Router);
    fixture.detectChanges();
  }

  beforeEach(() => {
    zeroResultsSpy = jest.fn(() =>
      of({
        data: [{ query: 'xxx', count: 4 }],
        meta: { page: 1, pageSize: 20, total: 1, period: 30 },
      }),
    );
  });

  it('defaults to period 30 and fetches', () => {
    configure();
    expect(page.period()).toBe(30);
    expect(zeroResultsSpy).toHaveBeenCalledWith({ period: 30, page: 1, pageSize: 20 });
  });

  it('honours the period URL param', () => {
    configure({ period: '7' });
    expect(page.period()).toBe(7);
    expect(zeroResultsSpy).toHaveBeenCalledWith({ period: 7, page: 1, pageSize: 20 });
  });

  it('falls back to 30 when period URL param is outside the allow-list', () => {
    configure({ period: '14' });
    expect(page.period()).toBe(30);
  });

  it('setPeriod navigates with the new period and resets page to 1', () => {
    configure({ period: '30', page: '4' });
    const navSpy = jest.spyOn(router, 'navigate').mockResolvedValue(true);
    page.setPeriod(90);
    expect(navSpy).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        queryParams: { period: 90, page: 1 },
      }),
    );
  });

  it('renders one row per query', () => {
    configure();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="zero-row-xxx"]')).toBeTruthy();
  });

  it('surfaces an error in the alert banner', () => {
    zeroResultsSpy = jest.fn(() => throwError(() => new Error('boom')));
    configure();
    expect(page.error()).toBeTruthy();
  });

  it('is a11y-clean at the default mount', async () => {
    configure();
    const results = await axe(fixture.nativeElement as HTMLElement);
    expect(results).toHaveNoViolations();
  });
});
