import { provideHttpClient, withFetch } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ADMIN_API_BASE_URL } from '../shared';
import { CountriesService } from './countries.service';

const fixture = {
  data: [
    { code: 'FR', name: 'France', region: 'EU', emoji: '🇫🇷', enabled: true, isDefault: true },
    { code: 'AE', name: 'UAE', region: 'EU', emoji: '🇦🇪', enabled: false, isDefault: false },
  ],
  defaultCode: 'FR',
};

describe('CountriesService', () => {
  let service: CountriesService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withFetch()),
        provideHttpClientTesting(),
        { provide: ADMIN_API_BASE_URL, useValue: '/api' },
        CountriesService,
      ],
    });
    service = TestBed.inject(CountriesService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('list() parses the envelope', (done) => {
    service.list().subscribe((res) => {
      expect(res.data).toHaveLength(2);
      done();
    });
    const req = http.expectOne('/api/v1/admin/countries');
    req.flush({ data: fixture });
  });

  it('listCached() serves two subscribers from one request', (done) => {
    const seen: number[] = [];
    service.listCached().subscribe((res) => seen.push(res.data.length));
    const req = http.expectOne('/api/v1/admin/countries');
    req.flush({ data: fixture });
    service.listCached().subscribe((res) => {
      seen.push(res.data.length);
      expect(seen).toEqual([2, 2]);
      // http.verify() in afterEach proves no second request went out.
      done();
    });
  });

  it('listCached() refetches after an update changes the enabled set', (done) => {
    service.listCached().subscribe();
    http.expectOne('/api/v1/admin/countries').flush({ data: fixture });
    service.update({ enabled: ['FR'] }).subscribe(() => {
      service.listCached().subscribe(() => done());
      http.expectOne('/api/v1/admin/countries').flush({ data: fixture });
    });
    http.expectOne('/api/v1/admin/countries').flush({ data: fixture });
  });

  it('list() accepts a null defaultCode', (done) => {
    service.list().subscribe((res) => {
      expect(res.defaultCode).toBeNull();
      done();
    });
    const req = http.expectOne('/api/v1/admin/countries');
    req.flush({ data: { data: fixture.data, defaultCode: null } });
  });

  it('list() rejects a country code that fails the length(2) guard', () => {
    return new Promise<void>((resolve, reject) => {
      service.list().subscribe({
        next: () => reject(new Error('expected Zod to reject a malformed code')),
        error: (err) => {
          expect(err).toBeDefined();
          resolve();
        },
      });
      const req = http.expectOne('/api/v1/admin/countries');
      req.flush({
        data: {
          data: [
            {
              code: 'Q',
              name: 'France',
              region: 'EU',
              emoji: '🇫🇷',
              enabled: true,
              isDefault: true,
            },
          ],
          defaultCode: 'Q',
        },
      });
    });
  });

  it('update() rejects empty enabled list via Zod', () => {
    expect(() => service.update({ enabled: [] }).subscribe()).toThrow();
    http.expectNone('/api/v1/admin/countries');
  });

  it('update() rejects default outside enabled list via Zod', () => {
    expect(() => service.update({ enabled: ['FR'], defaultCode: 'AE' }).subscribe()).toThrow();
    http.expectNone('/api/v1/admin/countries');
  });

  it('update() PATCHes a valid payload', (done) => {
    service.update({ enabled: ['FR', 'AE'], defaultCode: 'AE' }).subscribe(() => done());
    const req = http.expectOne('/api/v1/admin/countries');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body.defaultCode).toBe('AE');
    req.flush({ data: fixture });
  });

  it.each([
    [400, 'Bad Request'],
    [403, 'Forbidden'],
    [404, 'Not Found'],
  ] as const)('update() surfaces %i backend errors to the caller', (status, statusText) => {
    return new Promise<void>((resolve, reject) => {
      service.update({ enabled: ['FR'] }).subscribe({
        next: () => reject(new Error('expected the backend error to surface')),
        error: (err) => {
          expect(err).toBeDefined();
          resolve();
        },
      });
      const req = http.expectOne('/api/v1/admin/countries');
      req.flush({ error: { code: 'ERR', message: statusText } }, { status, statusText });
    });
  });
});
