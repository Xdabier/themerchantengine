import { provideHttpClient, withFetch } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ZodError } from 'zod';
import { ADMIN_API_BASE_URL } from '../shared';
import { GeoService } from './geo.service';

const productId = 'e4f5c9a4-1a1a-4a4a-8a8a-ab0000000040';

describe('GeoService', () => {
  let service: GeoService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withFetch()),
        provideHttpClientTesting(),
        { provide: ADMIN_API_BASE_URL, useValue: '/api' },
        GeoService,
      ],
    });
    service = TestBed.inject(GeoService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('getAiReadiness() parses score + signals', (done) => {
    service.getAiReadiness().subscribe((report) => {
      expect(report.score).toBe(72);
      expect(report.signals.faqEntries).toBe(0.5);
      done();
    });
    const req = http.expectOne('/api/v1/admin/geo/ai-readiness');
    expect(req.request.method).toBe('GET');
    req.flush({
      data: {
        score: 72,
        signals: {
          answerFirstDescription: 0.8,
          faqEntries: 0.5,
          completeSchemaMarkup: 1,
        },
      },
    });
  });

  it('getFaqSuggestions() returns empty list when none suggested', (done) => {
    service.getFaqSuggestions(productId).subscribe((res) => {
      expect(res.data).toEqual([]);
      done();
    });
    const req = http.expectOne(`/api/v1/admin/geo/products/${productId}/faqs/suggestions`);
    req.flush({ data: [] });
  });

  it('acceptFaqSuggestions() POSTs non-empty faq list', (done) => {
    const faqs = [
      {
        question: { default: 'Q?', en: 'Q?' },
        answer: { default: 'A.', en: 'A.' },
      },
    ];
    service.acceptFaqSuggestions(productId, { faqs }).subscribe((res) => {
      expect(res.data).toHaveLength(1);
      done();
    });
    const req = http.expectOne(`/api/v1/admin/geo/products/${productId}/faqs/accept`);
    expect(req.request.method).toBe('POST');
    req.flush({
      data: [
        {
          id: 'f4f5c9a4-1a1a-4a4a-8a8a-ab0000000050',
          productId,
          question: { default: 'Q?', en: 'Q?' },
          answer: { default: 'A.', en: 'A.' },
          sortOrder: 0,
        },
      ],
    });
  });

  it('acceptFaqSuggestions() delivers invalid-input validation errors through the Observable', (done) => {
    service.acceptFaqSuggestions(productId, { faqs: [] }).subscribe({
      next: () => done.fail('expected validation error'),
      error: (err) => {
        expect(err).toBeInstanceOf(ZodError);
        http.expectNone(`/api/v1/admin/geo/products/${productId}/faqs/accept`);
        done();
      },
    });
  });

  it('getAiReadiness() rejects signals outside the [0,1] range via Zod', (done) => {
    service.getAiReadiness().subscribe({
      next: () => done.fail('expected ZodError'),
      error: (err) => {
        expect(err).toBeTruthy();
        done();
      },
    });
    const req = http.expectOne('/api/v1/admin/geo/ai-readiness');
    req.flush({
      data: {
        score: 150,
        signals: { answerFirstDescription: 2, faqEntries: -1, completeSchemaMarkup: 0 },
      },
    });
  });

  it('getFaqSuggestions() propagates a 403 HttpErrorResponse without modification', (done) => {
    service.getFaqSuggestions(productId).subscribe({
      next: () => done.fail('expected error'),
      error: (err) => {
        expect(err.status).toBe(403);
        done();
      },
    });
    const req = http.expectOne(`/api/v1/admin/geo/products/${productId}/faqs/suggestions`);
    req.flush(
      { error: { code: 'FORBIDDEN', message: 'no' } },
      {
        status: 403,
        statusText: 'Forbidden',
      },
    );
  });

  it('acceptFaqSuggestions() handles the idempotent empty-data response shape', (done) => {
    const faqs = [{ question: { default: 'Q?', en: 'Q?' }, answer: { default: 'A.', en: 'A.' } }];
    service.acceptFaqSuggestions(productId, { faqs }).subscribe((res) => {
      expect(res.data).toEqual([]);
      done();
    });
    const req = http.expectOne(`/api/v1/admin/geo/products/${productId}/faqs/accept`);
    req.flush({ data: [] });
  });
});
