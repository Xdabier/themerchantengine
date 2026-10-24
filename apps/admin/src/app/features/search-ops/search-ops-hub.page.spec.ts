import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SearchAdminService } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { AuthStore } from '../../core/stores/auth.store';
import { SearchOpsHubPage } from './search-ops-hub.page';

expect.extend(toHaveNoViolations);

describe('SearchOpsHubPage', () => {
  let fixture: ComponentFixture<SearchOpsHubPage>;
  let page: SearchOpsHubPage;
  let reindexSpy: jest.Mock;
  let permissions: Set<string>;

  function configure() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        {
          provide: SearchAdminService,
          useValue: {
            listSynonyms: jest.fn(() => of({ data: [], meta: { page: 1, pageSize: 1, total: 4 } })),
            listMerchandisingRules: jest.fn(() =>
              of({ data: [], meta: { page: 1, pageSize: 1, total: 2 } }),
            ),
            zeroResults: jest.fn(() =>
              of({ data: [], meta: { page: 1, pageSize: 1, total: 7, period: 30 } }),
            ),
            reindex: reindexSpy,
          },
        },
        {
          provide: AuthStore,
          useValue: { locale: () => 'fr', hasPermission: (p: string) => permissions.has(p) },
        },
      ],
    });
    fixture = TestBed.createComponent(SearchOpsHubPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    permissions = new Set(['products:update', 'products:manage']);
    reindexSpy = jest.fn(() => of({ message: 'Reindex triggered', reindexed: 12 }));
  });

  it('renders the four section cards with counts', () => {
    configure();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="search-ops-hub"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="search-ops-card-synonyms"]')?.textContent).toContain(
      '4',
    );
    expect(
      el.querySelector('[data-testid="search-ops-card-merchandising"]')?.textContent,
    ).toContain('2');
    expect(el.querySelector('[data-testid="search-ops-card-zero-results"]')?.textContent).toContain(
      '7',
    );
    expect(el.querySelector('[data-testid="search-ops-card-reindex"]')).toBeTruthy();
  });

  it('triggerReindex announces the queued count on success', () => {
    configure();
    page.triggerReindex();
    fixture.detectChanges();
    expect(page.status()?.message).toContain('12');
    expect(page.status()?.tone).toBe('success');
  });

  it('triggerReindex surfaces failure tone on error', () => {
    reindexSpy = jest.fn(() => throwError(() => new Error('boom')));
    configure();
    page.triggerReindex();
    fixture.detectChanges();
    expect(page.status()?.tone).toBe('error');
  });

  it('hides the Re-index button when caller lacks products:manage', () => {
    permissions = new Set(['products:update']);
    configure();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="search-ops-reindex-button"]')).toBeNull();
  });

  it('is a11y-clean at the default mount', async () => {
    configure();
    const results = await axe(fixture.nativeElement as HTMLElement);
    expect(results).toHaveNoViolations();
  });
});
