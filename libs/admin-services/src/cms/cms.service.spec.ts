import { provideHttpClient, withFetch } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ADMIN_API_BASE_URL } from '../shared';
import { CmsService } from './cms.service';

const pageFixture = {
  id: 'a4f5c9a4-1a1a-4a4a-8a8a-ff0000000001',
  slug: '/about',
  type: 'STATIC',
  title: { default: 'About' },
  content: { default: '<p>Hello.</p>' },
  isPublished: true,
  sortOrder: 0,
  showInNavigation: false,
};

describe('CmsService', () => {
  let service: CmsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withFetch()),
        provideHttpClientTesting(),
        { provide: ADMIN_API_BASE_URL, useValue: '/api' },
        CmsService,
      ],
    });
    service = TestBed.inject(CmsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  describe('list()', () => {
    it('GETs with no query string when called with no args', (done) => {
      service.list().subscribe((res) => {
        expect(res.data.length).toBe(1);
        expect(res.meta.total).toBe(1);
        done();
      });
      const req = http.expectOne((r) => r.url === '/api/v1/admin/pages');
      expect(req.request.method).toBe('GET');
      expect(req.request.params.keys().length).toBe(0);
      req.flush({ data: [pageFixture], meta: { page: 1, pageSize: 20, total: 1 } });
    });

    it('applies page + pageSize as query params', (done) => {
      service.list({ page: 2, pageSize: 50 }).subscribe(() => done());
      const req = http.expectOne((r) => r.url === '/api/v1/admin/pages');
      expect(req.request.params.get('page')).toBe('2');
      expect(req.request.params.get('pageSize')).toBe('50');
      req.flush({ data: [pageFixture], meta: { page: 2, pageSize: 50, total: 1 } });
    });

    it('rejects page: 0 before firing HTTP', () => {
      expect(() => service.list({ page: 0 }).subscribe()).toThrow();
      http.expectNone('/api/v1/admin/pages');
    });

    it('rejects pageSize: 0 before firing HTTP', () => {
      expect(() => service.list({ pageSize: 0 }).subscribe()).toThrow();
      http.expectNone('/api/v1/admin/pages');
    });

    it('rejects pageSize: 101 (CMS_MAX_PAGE_SIZE is 100)', () => {
      expect(() => service.list({ pageSize: 101 }).subscribe()).toThrow();
      http.expectNone('/api/v1/admin/pages');
    });

    it('surfaces a malformed envelope as an observer error', (done) => {
      service.list().subscribe({
        next: () => done.fail('should not emit'),
        error: (err: unknown) => {
          expect(err).toBeTruthy();
          done();
        },
      });
      http.expectOne('/api/v1/admin/pages').flush({ data: [pageFixture] });
    });
  });

  describe('create()', () => {
    it('rejects slugs without a leading /', () => {
      expect(() =>
        service
          .create({
            slug: 'about',
            type: 'STATIC',
            title: { default: 'X' },
            content: { default: 'Y' },
          })
          .subscribe(),
      ).toThrow();
      http.expectNone('/api/v1/admin/pages');
    });

    it('accepts nested-slash slugs (the backend allows multi-segment paths)', (done) => {
      // The backend `create-page.dto.ts` slug rule is `/^(?:\/[a-z0-9-]+)+$/`
      // — one OR MORE "/"-prefixed segments — and `cms.schemas.ts` mirrors it
      // for parity. A nested path is therefore valid and must reach the API.
      service
        .create({
          slug: '/about/us',
          type: 'STATIC',
          title: { default: 'X' },
          content: { default: 'Y' },
        })
        .subscribe(() => done());
      const req = http.expectOne('/api/v1/admin/pages');
      expect(req.request.method).toBe('POST');
      req.flush({ data: pageFixture });
    });

    it('rejects uppercase slugs', () => {
      expect(() =>
        service
          .create({
            slug: '/About',
            type: 'STATIC',
            title: { default: 'X' },
            content: { default: 'Y' },
          })
          .subscribe(),
      ).toThrow();
      http.expectNone('/api/v1/admin/pages');
    });

    it('rejects an invalid type value', () => {
      expect(() =>
        service
          .create({
            slug: '/about',
            type: 'BLOG' as never,
            title: { default: 'X' },
            content: { default: 'Y' },
          })
          .subscribe(),
      ).toThrow();
      http.expectNone('/api/v1/admin/pages');
    });

    it('rejects sortOrder < 0', () => {
      expect(() =>
        service
          .create({
            slug: '/about',
            type: 'STATIC',
            title: { default: 'X' },
            content: { default: 'Y' },
            sortOrder: -1,
          })
          .subscribe(),
      ).toThrow();
      http.expectNone('/api/v1/admin/pages');
    });

    it('rejects template > 100 chars', () => {
      expect(() =>
        service
          .create({
            slug: '/about',
            type: 'STATIC',
            title: { default: 'X' },
            content: { default: 'Y' },
            template: 'x'.repeat(101),
          })
          .subscribe(),
      ).toThrow();
      http.expectNone('/api/v1/admin/pages');
    });

    it('POSTs a valid minimal body', (done) => {
      service
        .create({
          slug: '/about',
          type: 'STATIC',
          title: { default: 'About' },
          content: { default: 'Hi' },
        })
        .subscribe(() => done());
      const req = http.expectOne('/api/v1/admin/pages');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        slug: '/about',
        type: 'STATIC',
        title: { default: 'About' },
        content: { default: 'Hi' },
      });
      req.flush({ data: pageFixture });
    });

    it('POSTs a body with every optional field populated', (done) => {
      const payload = {
        slug: '/full',
        type: 'POLICY' as const,
        title: { default: 'Full' },
        content: { default: 'Hi' },
        isPublished: true,
        metaTitle: { default: 'Meta' },
        metaDescription: { default: 'Desc' },
        sortOrder: 3,
        showInNavigation: true,
        template: 'legal',
      };
      service.create(payload).subscribe(() => done());
      const req = http.expectOne('/api/v1/admin/pages');
      expect(req.request.body).toEqual(payload);
      req.flush({ data: { ...pageFixture, ...payload } });
    });

    it('surfaces a malformed response as an observer error', (done) => {
      service
        .create({
          slug: '/about',
          type: 'STATIC',
          title: { default: 'X' },
          content: { default: 'Y' },
        })
        .subscribe({
          next: () => done.fail('should not emit'),
          error: (err: unknown) => {
            expect(err).toBeTruthy();
            done();
          },
        });
      http.expectOne('/api/v1/admin/pages').flush({ data: { id: 'x' } });
    });
  });

  describe('update()', () => {
    it('PATCHes a partial body to /:id', (done) => {
      service.update(pageFixture.id, { isPublished: true }).subscribe((res) => {
        expect(res.id).toBe(pageFixture.id);
        done();
      });
      const req = http.expectOne(`/api/v1/admin/pages/${pageFixture.id}`);
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ isPublished: true });
      req.flush({ data: { ...pageFixture, isPublished: true } });
    });

    it('strips unknown keys — slug is not forwarded even if passed', (done) => {
      service.update(pageFixture.id, { slug: '/new' } as never).subscribe(() => done());
      const req = http.expectOne(`/api/v1/admin/pages/${pageFixture.id}`);
      expect(req.request.body).not.toHaveProperty('slug');
      req.flush({ data: pageFixture });
    });

    it('rejects an invalid type before firing HTTP', () => {
      expect(() => service.update(pageFixture.id, { type: 'BLOG' as never }).subscribe()).toThrow();
      http.expectNone(`/api/v1/admin/pages/${pageFixture.id}`);
    });

    it('surfaces a malformed response as an observer error', (done) => {
      service.update(pageFixture.id, { isPublished: true }).subscribe({
        next: () => done.fail('should not emit'),
        error: (err: unknown) => {
          expect(err).toBeTruthy();
          done();
        },
      });
      http.expectOne(`/api/v1/admin/pages/${pageFixture.id}`).flush({ data: { id: 'x' } });
    });
  });

  describe('delete()', () => {
    it('DELETEs and emits undefined on 204', (done) => {
      service.delete(pageFixture.id).subscribe((v) => {
        expect(v).toBeUndefined();
        done();
      });
      const req = http.expectOne(`/api/v1/admin/pages/${pageFixture.id}`);
      expect(req.request.method).toBe('DELETE');
      req.flush(null);
    });

    it('surfaces a 404 as an observer error', (done) => {
      service.delete(pageFixture.id).subscribe({
        next: () => done.fail('should not emit'),
        error: (err: unknown) => {
          expect(err).toBeTruthy();
          done();
        },
      });
      http
        .expectOne(`/api/v1/admin/pages/${pageFixture.id}`)
        .flush({ error: { code: 'NOT_FOUND' } }, { status: 404, statusText: 'Not Found' });
    });
  });
});
