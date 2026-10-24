import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { ApiConflictError, ApiServerError } from '@admin-types';
import { CmsService, type CmsPage } from '@admin-services';
import { axe, toHaveNoViolations } from 'jest-axe';
import { of, throwError } from 'rxjs';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { CmsPageEditorPage } from './page-editor.page';

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
    ...overrides,
  };
}

describe('CmsPageEditorPage', () => {
  let fixture: ComponentFixture<CmsPageEditorPage>;
  let page: CmsPageEditorPage;
  let createSpy: jest.Mock;
  let updateSpy: jest.Mock;
  let listSpy: jest.Mock;
  let paramId: string | null;

  function configure() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        {
          provide: CmsService,
          useValue: { create: createSpy, update: updateSpy, list: listSpy },
        },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { paramMap: convertToParamMap(paramId ? { id: paramId } : {}) },
          },
        },
      ],
    });
    fixture = TestBed.createComponent(CmsPageEditorPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    paramId = null;
    createSpy = jest.fn(() => of(makePage()));
    updateSpy = jest.fn(() => of(makePage()));
    listSpy = jest.fn(() => of({ data: [makePage()], meta: { page: 1, pageSize: 100, total: 1 } }));
  });

  describe('new mode', () => {
    it('mounts with the editor testid', () => {
      configure();
      expect(
        (fixture.nativeElement as HTMLElement).querySelector(
          '[data-testid="cms-page-editor-page"]',
        ),
      ).not.toBeNull();
    });

    it('starts pristine and invalid', () => {
      configure();
      expect(page.form.pristine).toBe(true);
      expect(page.form.invalid).toBe(true);
    });

    it('slug requires leading slash', () => {
      configure();
      page.form.controls.slug.setValue('no-slash');
      page.form.controls.slug.markAsTouched();
      expect(page.slugError()).toMatch(/start with/i);
    });

    it('slug rejects nested slashes (backend is flat)', () => {
      configure();
      page.form.controls.slug.setValue('/about/us');
      page.form.controls.slug.markAsTouched();
      expect(page.slugError()).toMatch(/lowercase|hyphens|digits/i);
    });

    it('slug rejects uppercase', () => {
      configure();
      page.form.controls.slug.setValue('/About');
      page.form.controls.slug.markAsTouched();
      expect(page.slugError()).toMatch(/lowercase|hyphens|digits/i);
    });

    it('title requires non-empty default locale', () => {
      configure();
      page.form.controls.title.setValue({ default: '   ' });
      page.form.controls.title.markAsTouched();
      expect(page.titleError()).toMatch(/required/i);
    });

    it('content requires non-empty default locale text', () => {
      configure();
      page.form.controls.content.setValue({ default: '<p>   </p>' });
      page.form.controls.content.markAsTouched();
      expect(page.contentError()).toMatch(/required/i);
    });

    it('submit calls create and navigates on success', () => {
      configure();
      const router = TestBed.inject(Router);
      const nav = jest.spyOn(router, 'navigate').mockResolvedValue(true);
      page.form.patchValue({
        slug: '/new-page',
        title: { default: 'New' },
        content: { default: '<p>Body</p>' },
      });
      page.form.markAsDirty();
      page.submit();
      expect(createSpy).toHaveBeenCalled();
      const call = createSpy.mock.calls[0][0];
      expect(call.slug).toBe('/new-page');
      expect(call.type).toBe('STATIC');
      expect(nav).toHaveBeenCalledWith(['/pages']);
    });

    it('maps 409 to a slug field error', () => {
      createSpy = jest.fn(() =>
        throwError(() => new ApiConflictError({ code: 'CONFLICT', message: 'dup' })),
      );
      configure();
      page.form.patchValue({
        slug: '/dup',
        title: { default: 'X' },
        content: { default: '<p>Y</p>' },
      });
      page.form.markAsDirty();
      page.submit();
      expect(page.conflict()).toBe(true);
      expect(page.slugError()).toMatch(/already exists/i);
    });

    it('has no axe violations on the create form', async () => {
      configure();
      const results = await axe(fixture.nativeElement);
      expect(results).toHaveNoViolations();
    });

    it('surfaces a top-level error for non-409 failures', () => {
      createSpy = jest.fn(() =>
        throwError(() => new ApiServerError({ code: 'X', message: 'boom' })),
      );
      configure();
      page.form.patchValue({
        slug: '/oops',
        title: { default: 'X' },
        content: { default: '<p>Y</p>' },
      });
      page.form.markAsDirty();
      page.submit();
      expect(page.topError()).toBeTruthy();
    });
  });

  describe('edit mode', () => {
    it('loads the existing page and disables slug', () => {
      paramId = 'p-1';
      listSpy = jest.fn(() =>
        of({
          data: [makePage({ id: 'p-1', slug: '/legal', type: 'POLICY' })],
          meta: { page: 1, pageSize: 100, total: 1 },
        }),
      );
      configure();
      expect(page.editingId()).toBe('p-1');
      expect(page.form.controls.slug.disabled).toBe(true);
      expect(page.form.controls.slug.value).toBe('/legal');
    });

    it('submit calls update without slug in the payload', () => {
      paramId = 'p-1';
      configure();
      const router = TestBed.inject(Router);
      const nav = jest.spyOn(router, 'navigate').mockResolvedValue(true);
      page.form.markAsDirty();
      page.form.controls.title.setValue({ default: 'Edited' });
      page.submit();
      expect(updateSpy).toHaveBeenCalled();
      const [id, patch] = updateSpy.mock.calls[0];
      expect(id).toBe('p-1');
      expect(patch).not.toHaveProperty('slug');
      expect(patch.title).toEqual({ default: 'Edited' });
      expect(nav).toHaveBeenCalledWith(['/pages']);
    });
  });
});
