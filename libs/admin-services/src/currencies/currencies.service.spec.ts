import { provideHttpClient, withFetch } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ZodError } from 'zod';
import { ADMIN_API_BASE_URL } from '../shared';
import { CurrenciesService } from './currencies.service';

const fixture = {
  data: [
    {
      code: 'EUR',
      name: 'Euro',
      symbol: 'ر.ق',
      region: 'GCC',
      decimalPlaces: 2,
      enabled: true,
      isDefault: true,
    },
    {
      code: 'USD',
      name: 'US Dollar',
      symbol: '$',
      region: 'Americas',
      decimalPlaces: 2,
      enabled: false,
      isDefault: false,
    },
  ],
  defaultCode: 'EUR',
};

describe('CurrenciesService', () => {
  let service: CurrenciesService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withFetch()),
        provideHttpClientTesting(),
        { provide: ADMIN_API_BASE_URL, useValue: '/api' },
        CurrenciesService,
      ],
    });
    service = TestBed.inject(CurrenciesService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('list() parses the envelope', (done) => {
    service.list().subscribe((res) => {
      expect(res.data).toHaveLength(2);
      done();
    });
    const req = http.expectOne('/api/v1/admin/currencies');
    req.flush({ data: fixture });
  });

  it('getStore() parses the store-currency envelope', (done) => {
    service.getStore().subscribe((res) => {
      expect(res).toEqual({
        code: 'EUR',
        symbol: 'ر.ق',
        decimalPlaces: 2,
        enabled: ['EUR'],
      });
      done();
    });
    const req = http.expectOne('/api/v1/admin/currencies/store');
    expect(req.request.method).toBe('GET');
    req.flush({ data: { code: 'EUR', symbol: 'ر.ق', decimalPlaces: 2, enabled: ['EUR'] } });
  });

  it('getStore() rejects a malformed payload', () => {
    return new Promise<void>((resolve, reject) => {
      service.getStore().subscribe({
        next: () => reject(new Error('expected the malformed payload to reject')),
        error: (err) => {
          expect(err).toBeDefined();
          resolve();
        },
      });
      const req = http.expectOne('/api/v1/admin/currencies/store');
      req.flush({ data: { code: 'qar', symbol: 'ر.ق', decimalPlaces: 2, enabled: ['EUR'] } });
    });
  });

  it('update() rejects empty enabled list through the stream', () => {
    const next = jest.fn();
    const error = jest.fn();
    service.update({ enabled: [] }).subscribe({ next, error });
    expect(next).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.any(ZodError));
    http.expectNone('/api/v1/admin/currencies');
  });

  it('update() rejects default outside enabled list through the stream', () => {
    const next = jest.fn();
    const error = jest.fn();
    service.update({ enabled: ['EUR'], defaultCode: 'USD' }).subscribe({ next, error });
    expect(next).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.any(ZodError));
    http.expectNone('/api/v1/admin/currencies');
  });

  it('update() PATCHes a valid payload', (done) => {
    service.update({ enabled: ['EUR', 'USD'], defaultCode: 'USD' }).subscribe(() => done());
    const req = http.expectOne('/api/v1/admin/currencies');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body.defaultCode).toBe('USD');
    req.flush({ data: fixture });
  });

  it('list() accepts a null defaultCode', (done) => {
    service.list().subscribe((res) => {
      expect(res.defaultCode).toBeNull();
      done();
    });
    const req = http.expectOne('/api/v1/admin/currencies');
    req.flush({
      data: {
        data: [
          {
            code: 'EUR',
            name: 'Euro',
            symbol: 'ر.ق',
            region: 'GCC',
            decimalPlaces: 2,
            enabled: true,
            isDefault: false,
          },
        ],
        defaultCode: null,
      },
    });
  });

  it('list() rejects an ISO code that fails the regex guard', () => {
    return new Promise<void>((resolve, reject) => {
      service.list().subscribe({
        next: () => reject(new Error('expected the malformed row to reject')),
        error: (err) => {
          expect(err).toBeDefined();
          resolve();
        },
      });
      const req = http.expectOne('/api/v1/admin/currencies');
      req.flush({
        data: {
          data: [
            {
              code: 'usd',
              name: 'US Dollar',
              symbol: '$',
              region: 'Americas',
              decimalPlaces: 2,
              enabled: true,
              isDefault: true,
            },
          ],
          defaultCode: 'usd',
        },
      });
    });
  });

  it.each([
    [400, 'Bad Request'],
    [403, 'Forbidden'],
    [404, 'Not Found'],
  ] as const)('update() surfaces %i backend errors to the caller', (status, statusText) => {
    return new Promise<void>((resolve, reject) => {
      service.update({ enabled: ['EUR'] }).subscribe({
        next: () => reject(new Error('expected the backend error to surface')),
        error: (err) => {
          expect(err).toBeDefined();
          resolve();
        },
      });
      const req = http.expectOne('/api/v1/admin/currencies');
      req.flush({ error: { code: 'ERR', message: statusText } }, { status, statusText });
    });
  });
});
