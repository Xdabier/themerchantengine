import { Dialog } from '@angular/cdk/dialog';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { WebhooksService } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { AuthStore } from '../../core/stores/auth.store';
import { ApiServerError } from '@admin-types';
import { WebhooksListPage } from './webhooks-list.page';
import { provideStoreSettingsStub } from '../../../testing/store-settings.mock';

expect.extend(toHaveNoViolations);

const sample = {
  id: 'wh-1',
  url: 'https://example.com/hook',
  events: ['order.created', 'order.shipped'],
  isActive: true,
  failureCount: 0,
  lastDeliveredAt: null,
  createdAt: '2026-04-15T00:00:00.000Z',
  updatedAt: '2026-04-15T00:00:00.000Z',
};
const listFixture = {
  data: [sample],
  meta: { page: 1, pageSize: 20, total: 1 },
};

describe('WebhooksListPage', () => {
  let fixture: ComponentFixture<WebhooksListPage>;
  let page: WebhooksListPage;
  let listSpy: jest.Mock;
  let removeSpy: jest.Mock;
  let queryParams$: BehaviorSubject<Record<string, string>>;
  let dialogResult: boolean;
  let permissions: Set<string>;

  function configure(params: Record<string, string> = {}) {
    queryParams$ = new BehaviorSubject<Record<string, string>>(params);
    dialogResult = true;
    TestBed.configureTestingModule({
      providers: [
        provideStoreSettingsStub(),
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        { provide: WebhooksService, useValue: { list: listSpy, remove: removeSpy } },
        {
          provide: AuthStore,
          useValue: { locale: () => 'fr', hasPermission: (p: string) => permissions.has(p) },
        },
        { provide: ActivatedRoute, useValue: { queryParams: queryParams$.asObservable() } },
        {
          provide: Dialog,
          useValue: {
            open: jest.fn(() => ({
              closed: of(dialogResult),
            })),
          },
        },
      ],
    });
    fixture = TestBed.createComponent(WebhooksListPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    permissions = new Set(['settings:view', 'settings:manage']);
    listSpy = jest.fn(() => of(listFixture));
    removeSpy = jest.fn(() => of(undefined));
  });

  it('fetches with defaults when URL has no filters', () => {
    configure();
    expect(listSpy).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
    expect(page.total()).toBe(1);
  });

  it('forwards page from URL', () => {
    configure({ page: '3' });
    expect(listSpy).toHaveBeenCalledWith({ page: 3, pageSize: 20 });
  });

  it('renders one row per webhook', () => {
    configure();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="webhook-row-wh-1"]')).not.toBeNull();
  });

  it('hides the create CTA when settings:manage is missing', () => {
    permissions = new Set(['settings:view']);
    configure();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="webhooks-new-cta"]')).toBeNull();
  });

  it('eventsPreview shows count + truncated list', () => {
    configure();
    expect(page.eventsPreview(['a', 'b', 'c'])).toBe('a, b, c');
    expect(page.eventsPreview(['a', 'b', 'c', 'd', 'e'])).toBe('a, b, c +2 more');
    expect(page.eventsPreview([])).toBe('—');
  });

  it('confirmDelete calls remove on confirmation', async () => {
    configure();
    await page.confirmDelete(sample);
    expect(removeSpy).toHaveBeenCalledWith('wh-1');
  });

  it('confirmDelete does not call remove on cancel', async () => {
    configure();
    dialogResult = false;
    await page.confirmDelete(sample);
    expect(removeSpy).not.toHaveBeenCalled();
  });

  it('error from list surfaces as a string', () => {
    listSpy = jest.fn(() => throwError(() => new ApiServerError({ code: 'X', message: 'boom' })));
    configure();
    expect(page.error()).toBeTruthy();
  });

  it('is axe-clean', async () => {
    configure();
    const results = await axe(fixture.nativeElement as Element);
    expect(results).toHaveNoViolations();
  });
});
