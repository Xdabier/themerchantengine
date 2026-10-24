import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { Dialog } from '@angular/cdk/dialog';
import { ApiServerError } from '@admin-types';
import { CmsService, type CmsPage } from '@admin-services';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { AuthStore } from '../../core/stores/auth.store';
import { axe, toHaveNoViolations } from 'jest-axe';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { CmsPagesListPage } from './pages-list.page';
import { provideStoreSettingsStub } from '../../../testing/store-settings.mock';

expect.extend(toHaveNoViolations);

function makePage(overrides: Partial<CmsPage> = {}): CmsPage {
  return {
    id: 'p-1',
    slug: '/about',
    type: 'STATIC',
    title: { default: 'About' },
    content: { default: '<p>Hi</p>' },
    isPublished: true,
    sortOrder: 0,
    showInNavigation: false,
    updatedAt: '2026-04-20T00:00:00.000Z',
    ...overrides,
  };
}

describe('CmsPagesListPage', () => {
  let fixture: ComponentFixture<CmsPagesListPage>;
  let component: CmsPagesListPage;
  let listSpy: jest.Mock;
  let deleteSpy: jest.Mock;
  let permissions: Set<string>;
  let queryParams$: BehaviorSubject<Record<string, string>>;

  function configure() {
    TestBed.configureTestingModule({
      providers: [
        provideStoreSettingsStub(),
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        { provide: CmsService, useValue: { list: listSpy, delete: deleteSpy } },
        {
          provide: AuthStore,
          useValue: {
            locale: () => 'fr',
            hasPermission: (p: string) => permissions.has(p),
          },
        },
        {
          provide: ActivatedRoute,
          useValue: { queryParams: queryParams$.asObservable(), snapshot: { queryParams: {} } },
        },
      ],
    });
    fixture = TestBed.createComponent(CmsPagesListPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    permissions = new Set(['cms:view', 'cms:create', 'cms:update', 'cms:delete']);
    queryParams$ = new BehaviorSubject<Record<string, string>>({});
    listSpy = jest.fn(() => of({ data: [makePage()], meta: { page: 1, pageSize: 20, total: 1 } }));
    deleteSpy = jest.fn(() => of(undefined));
  });

  it('mounts with the page testid', () => {
    configure();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="cms-pages-list-page"]'),
    ).not.toBeNull();
  });

  it('fetches on mount and renders the row', () => {
    configure();
    expect(listSpy).toHaveBeenCalled();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="cms-page-row-p-1"]'),
    ).not.toBeNull();
  });

  it('shows the Create page CTA when cms:create is granted', () => {
    configure();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="cms-pages-new-cta"]'),
    ).not.toBeNull();
  });

  it('hides the Create page CTA when cms:create is missing', () => {
    permissions = new Set(['cms:view']);
    configure();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="cms-pages-new-cta"]'),
    ).toBeNull();
  });

  it('hides row actions when no manage permission', () => {
    permissions = new Set(['cms:view']);
    configure();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="cms-page-delete-p-1"]'),
    ).toBeNull();
  });

  it('shows empty state copy when total === 0', () => {
    listSpy = jest.fn(() => of({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }));
    configure();
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('[data-testid="cms-pages-empty"]'),
    ).not.toBeNull();
  });

  it('surfaces an error when the service errors', () => {
    listSpy = jest.fn(() => throwError(() => new ApiServerError({ code: 'X', message: 'boom' })));
    configure();
    const err = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="cms-pages-error"]',
    );
    expect(err?.textContent?.trim().length ?? 0).toBeGreaterThan(0);
  });

  it('goToPage updates the URL', () => {
    listSpy = jest.fn(() =>
      of({ data: [makePage()], meta: { page: 1, pageSize: 20, total: 100 } }),
    );
    configure();
    const router = TestBed.inject(Router);
    const nav = jest.spyOn(router, 'navigate').mockResolvedValue(true);
    component.goToPage(2);
    expect(nav).toHaveBeenCalled();
  });

  it('confirmDelete cancels when the dialog returns false', async () => {
    configure();
    jest.spyOn(TestBed.inject(Dialog), 'open').mockReturnValue({
      closed: of(false),
      close: () => undefined,
    } as never);
    await component.confirmDelete(makePage());
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it('has no axe violations on the list mount', async () => {
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });

  it('confirmDelete calls delete and refetches when confirmed', async () => {
    configure();
    jest.spyOn(TestBed.inject(Dialog), 'open').mockReturnValue({
      closed: of(true),
      close: () => undefined,
    } as never);
    listSpy.mockClear();
    await component.confirmDelete(makePage());
    expect(deleteSpy).toHaveBeenCalledWith('p-1');
    expect(listSpy).toHaveBeenCalled();
  });
});
