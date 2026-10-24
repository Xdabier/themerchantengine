import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CampaignsService } from '@admin-services';
import { ApiError, ApiForbiddenError } from '@admin-types';
import * as adminUi from '@admin-ui';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { CampaignsListPage } from './campaigns-list.page';

void adminUi;
expect.extend(toHaveNoViolations);

const campaignFixture = {
  id: 'camp-1',
  name: 'Spring sale',
  subject: { en: 'Sale', fr: 'Vente' },
  body: { en: 'Shop', fr: 'Achetez' },
  segment: 'ALL_CONFIRMED' as const,
  couponCode: null,
  status: 'DRAFT' as const,
  kind: 'BROADCAST' as const,
  createdAt: '2026-06-19T00:00:00.000Z',
};

describe('CampaignsListPage', () => {
  let fixture: ComponentFixture<CampaignsListPage>;
  let page: CampaignsListPage;
  let listSpy: jest.Mock;

  function configure(perms: string[] = ['campaigns:view', 'campaigns:manage', 'campaigns:create']) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        { provide: CampaignsService, useValue: { listCampaigns: listSpy } },
      ],
    });
    TestBed.inject(AuthStore).setSession({
      user: { id: 'u', email: 'a@b', permissions: perms, roles: [], status: 'active' },
    });
    fixture = TestBed.createComponent(CampaignsListPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    listSpy = jest.fn(() =>
      of({ data: [campaignFixture], meta: { page: 1, pageSize: 20, total: 1 } }),
    );
  });

  it('loads campaign rows', () => {
    configure();
    expect(page.rows()).toHaveLength(1);
  });

  it('renders no pager under an empty list', () => {
    listSpy = jest.fn(() => of({ data: [], meta: { page: 1, pageSize: 20, total: 0 } }));
    configure();
    // Finding E13: "No campaigns yet." used to ship with Prev/Next under it.
    expect(fixture.nativeElement.querySelector('[data-testid="campaigns-prev"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="campaigns-next"]')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('[data-testid="campaigns-meta"]').textContent,
    ).not.toContain('Showing');
  });

  it('renders no pager when everything fits on one page', () => {
    configure();
    expect(fixture.nativeElement.querySelector('[data-testid="campaigns-prev"]')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('[data-testid="campaigns-meta"]').textContent,
    ).toContain('Showing 1–1 of 1');
  });

  it('renders the pager once there is a second page', () => {
    listSpy = jest.fn(() =>
      of({ data: [campaignFixture], meta: { page: 1, pageSize: 20, total: 42 } }),
    );
    configure();
    expect(fixture.nativeElement.querySelector('[data-testid="campaigns-prev"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="campaigns-next"]')).toBeTruthy();
  });

  it('canManage is false for view-only perms', () => {
    configure(['campaigns:view']);
    expect(page.canManage()).toBe(false);
  });

  it('403 surfaces a permission-safe error', () => {
    listSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure();
    expect(page.error()).toContain('permission');
  });

  it('generic ApiError surfaces the typed message', () => {
    listSpy = jest.fn(() =>
      throwError(
        () => new ApiError({ code: 'INTERNAL_SERVER_ERROR', message: 'boom', status: 500 }),
      ),
    );
    configure();
    expect(page.error()).toBe('boom');
  });

  it('has no axe violations', async () => {
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });
});
