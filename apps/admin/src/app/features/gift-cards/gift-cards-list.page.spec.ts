import { ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { GiftCardsService } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { GiftCardsListPage } from './gift-cards-list.page';

expect.extend(toHaveNoViolations);

const fixtures = [
  {
    id: 'g1',
    code: 'GIFT-0001',
    initialBalance: 100,
    currentBalance: 75,
    currency: 'USD',
    recipientEmail: 'a@b.com',
    isActive: true,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  },
  {
    id: 'g2',
    code: 'GIFT-0002',
    initialBalance: 50,
    currentBalance: 0,
    currency: 'USD',
    isActive: true,
    createdAt: new Date().toISOString(),
  },
];

describe('GiftCardsListPage', () => {
  let fixture: ComponentFixture<GiftCardsListPage>;
  let page: GiftCardsListPage;
  let listSpy: jest.Mock;

  function configure(perms: string[] = ['gift_cards:view']) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        { provide: GiftCardsService, useValue: { list: listSpy } },
      ],
    });
    TestBed.inject(AuthStore).setSession({
      user: { id: 'u', email: 'a@b', permissions: perms, roles: [], status: 'active' },
    });
    fixture = TestBed.createComponent(GiftCardsListPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    listSpy = jest.fn(() =>
      of({ data: fixtures, meta: { page: 1, pageSize: 20, total: fixtures.length } }),
    );
  });

  it('loads rows from the service', () => {
    configure();
    expect(page.rows()).toHaveLength(2);
    expect(page.total()).toBe(2);
  });

  it('canIssue is false without the create permission', () => {
    configure(['gift_cards:view']);
    expect(page.canIssue()).toBe(false);
  });

  it('canIssue is true with gift_cards:create', () => {
    configure(['gift_cards:view', 'gift_cards:create']);
    expect(page.canIssue()).toBe(true);
  });

  it('surfaces a permission-safe ApiForbiddenError', () => {
    listSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure();
    expect(page.error()).toContain('permission');
  });

  it('surfaces ApiNotFoundError as the gift-cards-not-found error', () => {
    listSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    configure();
    expect(page.error()).toBe('Gift cards not found.');
  });

  it('has no axe violations', async () => {
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });
});
