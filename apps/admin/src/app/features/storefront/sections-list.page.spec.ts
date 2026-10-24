import { Dialog } from '@angular/cdk/dialog';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { StorefrontConfigService } from '@admin-services';
import { ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { axe, toHaveNoViolations } from 'jest-axe';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { StorefrontSectionsListPage } from './sections-list.page';

expect.extend(toHaveNoViolations);

describe('StorefrontSectionsListPage', () => {
  let fixture: ComponentFixture<StorefrontSectionsListPage>;
  let listSectionsSpy: jest.Mock;
  const paramMap$ = new BehaviorSubject({
    get: (key: string) => (key === 'pageSlug' ? 'home' : null),
  });

  function configure() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        { provide: Dialog, useValue: { open: jest.fn() } },
        { provide: StorefrontConfigService, useValue: { listSections: listSectionsSpy } },
        { provide: ActivatedRoute, useValue: { paramMap: paramMap$.asObservable() } },
      ],
    });
    TestBed.inject(AuthStore).setSession({
      user: {
        id: 'u',
        email: 'a@b',
        permissions: ['storefront_config:view', 'storefront_config:manage'],
        roles: [],
        status: 'active',
      },
    });
    fixture = TestBed.createComponent(StorefrontSectionsListPage);
    fixture.detectChanges();
  }

  beforeEach(() => {
    listSectionsSpy = jest.fn(() =>
      of({ data: [], meta: { page: 1, pageSize: 100, total: 0, totalPages: 1 } }),
    );
  });

  it('mounts and loads sections for the active pageSlug', () => {
    configure();
    expect(listSectionsSpy).toHaveBeenCalledWith('home', { pageSize: 100 });
  });

  it('surfaces a forbidden copy on ApiForbiddenError', () => {
    listSectionsSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure();
    expect(fixture.componentInstance.error()).toContain('permission');
  });

  it('surfaces the not-found copy on ApiNotFoundError', () => {
    listSectionsSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    configure();
    expect(fixture.componentInstance.error()).toBe('Section no longer exists.');
  });

  it('has no axe violations', async () => {
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });
});
