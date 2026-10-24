import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { ApiConflictError, ApiServerError } from '@admin-types';
import { SeoService } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { SeoRedirectNewPage } from './seo-redirect-new.page';

expect.extend(toHaveNoViolations);

describe('SeoRedirectNewPage', () => {
  let fixture: ComponentFixture<SeoRedirectNewPage>;
  let page: SeoRedirectNewPage;
  let createSpy: jest.Mock;

  function configure() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        { provide: SeoService, useValue: { createRedirect: createSpy } },
      ],
    });
    fixture = TestBed.createComponent(SeoRedirectNewPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    createSpy = jest.fn(() =>
      of({ id: 'r1', fromPath: '/old', toPath: '/new', type: 'MOVED_PERMANENTLY' }),
    );
  });

  it('renders the form with both path fields', () => {
    configure();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="seo-redirect-from"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="seo-redirect-to"]')).not.toBeNull();
  });

  it('submit is disabled while the form is pristine', () => {
    configure();
    expect(page.form.invalid).toBe(true);
    expect(page.form.pristine).toBe(true);
  });

  it('fromPath requires a leading slash', () => {
    configure();
    page.form.controls.fromPath.setValue('old');
    page.form.controls.fromPath.markAsTouched();
    expect(page.fromError()).toMatch(/start with/i);
  });

  it('toPath requires a leading slash', () => {
    configure();
    page.form.controls.toPath.setValue('new');
    page.form.controls.toPath.markAsTouched();
    expect(page.toError()).toMatch(/start with/i);
  });

  it('type defaults to MOVED_PERMANENTLY', () => {
    configure();
    expect(page.form.controls.type.value).toBe('MOVED_PERMANENTLY');
  });

  it('submit calls createRedirect and navigates on success', () => {
    configure();
    const router = TestBed.inject(Router);
    const nav = jest.spyOn(router, 'navigate').mockResolvedValue(true);
    page.form.setValue({ fromPath: '/old', toPath: '/new', type: 'MOVED_PERMANENTLY' });
    page.form.markAsDirty();
    page.submit();
    expect(createSpy).toHaveBeenCalledWith({
      fromPath: '/old',
      toPath: '/new',
      type: 'MOVED_PERMANENTLY',
    });
    expect(nav).toHaveBeenCalledWith(['/seo/redirects']);
  });

  it('409 conflict surfaces as a field error on fromPath', () => {
    configure();
    createSpy.mockReturnValue(
      throwError(() => new ApiConflictError({ code: 'CONFLICT', message: 'dup' })),
    );
    page.form.setValue({ fromPath: '/dup', toPath: '/new', type: 'MOVED_PERMANENTLY' });
    page.form.markAsDirty();
    page.submit();
    expect(page.fromError()).toMatch(/already exists/i);
    expect(page.topError()).toBeNull();
  });

  it('non-409 errors surface as a top-level alert', () => {
    configure();
    createSpy.mockReturnValue(
      throwError(() => new ApiServerError({ code: 'SERVER', message: 'boom', status: 500 })),
    );
    page.form.setValue({ fromPath: '/old', toPath: '/new', type: 'MOVED_PERMANENTLY' });
    page.form.markAsDirty();
    page.submit();
    expect(page.topError()).toBeTruthy();
    expect(page.conflict()).toBe(false);
  });

  it('editing fromPath after a conflict clears the conflict flag', () => {
    configure();
    createSpy.mockReturnValue(
      throwError(() => new ApiConflictError({ code: 'CONFLICT', message: 'dup' })),
    );
    page.form.setValue({ fromPath: '/dup', toPath: '/new', type: 'MOVED_PERMANENTLY' });
    page.form.markAsDirty();
    page.submit();
    expect(page.conflict()).toBe(true);
    page.form.controls.fromPath.setValue('/dup-2');
    expect(page.conflict()).toBe(false);
  });

  it('is axe-clean', async () => {
    configure();
    const results = await axe(fixture.nativeElement as Element);
    expect(results).toHaveNoViolations();
  });
});
