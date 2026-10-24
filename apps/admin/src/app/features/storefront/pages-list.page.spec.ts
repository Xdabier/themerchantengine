import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { StorefrontConfigService } from '@admin-services';
import { ApiForbiddenError, ApiNotFoundError } from '@admin-types';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { StorefrontPagesListPage } from './pages-list.page';

expect.extend(toHaveNoViolations);

describe('StorefrontPagesListPage', () => {
  let fixture: ComponentFixture<StorefrontPagesListPage>;
  let listPagesSpy: jest.Mock;

  function configure() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        { provide: StorefrontConfigService, useValue: { listPages: listPagesSpy } },
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
    fixture = TestBed.createComponent(StorefrontPagesListPage);
    fixture.detectChanges();
  }

  beforeEach(() => {
    listPagesSpy = jest.fn(() => of({ data: ['home', 'about'] }));
  });

  it('mounts and lists storefront page slugs', () => {
    configure();
    expect(fixture.componentInstance.slugs()).toEqual(['home', 'about']);
  });

  it('shows a readable page name with the slug as secondary text', () => {
    listPagesSpy = jest.fn(() => of({ data: ['home', 'about-us'] }));
    configure();
    const row = fixture.nativeElement.querySelector(
      '[data-testid="storefront-page-link-about-us"]',
    ) as HTMLElement;
    expect(row.textContent).toContain('About Us');
    expect(row.textContent).toContain('/about-us');
  });

  it('surfaces a forbidden copy on ApiForbiddenError', () => {
    listPagesSpy = jest.fn(() =>
      throwError(() => new ApiForbiddenError({ code: 'FORBIDDEN', message: 'nope' })),
    );
    configure();
    expect(fixture.componentInstance.error()).toContain('permission');
  });

  it('surfaces the not-found copy on ApiNotFoundError', () => {
    listPagesSpy = jest.fn(() =>
      throwError(() => new ApiNotFoundError({ code: 'NOT_FOUND', message: 'missing' })),
    );
    configure();
    expect(fixture.componentInstance.error()).toBe('Pages not found.');
  });

  it('has no axe violations', async () => {
    configure();
    const results = await axe(fixture.nativeElement);
    expect(results).toHaveNoViolations();
  });
});
