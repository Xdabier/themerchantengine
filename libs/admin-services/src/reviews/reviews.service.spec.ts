import { provideHttpClient, withFetch } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ADMIN_API_BASE_URL } from '../shared';
import { ReviewsService } from './reviews.service';

// Admin reads send `X-Resolve-Locale: false`, so the backend serves the raw
// Translatable JSONB ({ default, fr, en }) for title/body/question/answer, not
// a resolved string. Fixtures mirror that wire shape so the real parse path is
// exercised. (body is non-null JSONB → always present.)
const reviewFixture = {
  id: 'a4f5c9a4-1a1a-4a4a-8a8a-dd0000000001',
  productId: 'd4f5c9a4-1a1a-4a4a-8a8a-dddddddddddd',
  rating: 5,
  title: { default: 'Great fit', en: 'Great fit' },
  body: { default: 'Perfect fit, fast shipping.', en: 'Perfect fit, fast shipping.' },
  status: 'PENDING',
  createdAt: '2026-04-15T12:00:00.000Z',
};

const questionFixture = {
  id: 'a4f5c9a4-1a1a-4a4a-8a8a-dd0000000002',
  productId: 'd4f5c9a4-1a1a-4a4a-8a8a-dddddddddddd',
  question: { default: 'What is the return window?', en: 'What is the return window?' },
  status: 'PENDING',
  createdAt: '2026-04-15T12:00:00.000Z',
};

describe('ReviewsService', () => {
  let service: ReviewsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withFetch()),
        provideHttpClientTesting(),
        { provide: ADMIN_API_BASE_URL, useValue: '/api' },
        ReviewsService,
      ],
    });
    service = TestBed.inject(ReviewsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('listReviews() filters by status + rating', (done) => {
    service.listReviews({ status: 'PENDING', rating: 5 }).subscribe(() => done());
    const req = http.expectOne((r) => r.url === '/api/v1/admin/reviews');
    expect(req.request.params.get('status')).toBe('PENDING');
    expect(req.request.params.get('rating')).toBe('5');
    req.flush({ data: [reviewFixture], meta: { page: 1, pageSize: 20, total: 1 } });
  });

  it('listReviews() forwards productId + userId + sort params', (done) => {
    service
      .listReviews({
        productId: 'prod-1',
        userId: 'user-1',
        sortBy: 'rating',
        sortOrder: 'desc',
      })
      .subscribe(() => done());
    const req = http.expectOne((r) => r.url === '/api/v1/admin/reviews');
    expect(req.request.params.get('productId')).toBe('prod-1');
    expect(req.request.params.get('userId')).toBe('user-1');
    expect(req.request.params.get('sortBy')).toBe('rating');
    expect(req.request.params.get('sortOrder')).toBe('desc');
    req.flush({ data: [reviewFixture], meta: { page: 1, pageSize: 20, total: 1 } });
  });

  it('listReviews() throws on invalid sortBy before HTTP call', () => {
    expect(() =>
      service
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .listReviews({ sortBy: 'bogus' as any })
        .subscribe(),
    ).toThrow();
    http.expectNone((r) => r.url === '/api/v1/admin/reviews');
  });

  it('approveReview() PATCHes the action route', (done) => {
    service.approveReview(reviewFixture.id).subscribe(() => done());
    const req = http.expectOne(`/api/v1/admin/reviews/${reviewFixture.id}/approve`);
    expect(req.request.method).toBe('PATCH');
    req.flush({ data: { ...reviewFixture, status: 'PUBLISHED' } });
  });

  it('rejectReview() accepts optional reason', (done) => {
    service.rejectReview(reviewFixture.id, { reason: 'Spam' }).subscribe(() => done());
    const req = http.expectOne(`/api/v1/admin/reviews/${reviewFixture.id}/reject`);
    expect(req.request.body).toEqual({ reason: 'Spam' });
    req.flush({ data: { ...reviewFixture, status: 'HIDDEN' } });
  });

  it('rejectReview() sends {} when reason is omitted', (done) => {
    service.rejectReview(reviewFixture.id).subscribe(() => done());
    const req = http.expectOne(`/api/v1/admin/reviews/${reviewFixture.id}/reject`);
    expect(req.request.body).toEqual({});
    req.flush({ data: { ...reviewFixture, status: 'HIDDEN' } });
  });

  it('rejectReview() rejects reason > 1000 chars before HTTP call', () => {
    expect(() =>
      service.rejectReview(reviewFixture.id, { reason: 'x'.repeat(1001) }).subscribe(),
    ).toThrow();
    http.expectNone(`/api/v1/admin/reviews/${reviewFixture.id}/reject`);
  });

  it('updateReview() PATCHes the admin route with allowed fields', (done) => {
    service
      .updateReview(reviewFixture.id, {
        rating: 4,
        title: 'Curated copy',
        body: 'Edited body — tighter wording.',
        status: 'PUBLISHED',
        reason: 'Editorial polish',
      })
      .subscribe(() => done());
    const req = http.expectOne(`/api/v1/admin/reviews/${reviewFixture.id}`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({
      rating: 4,
      title: 'Curated copy',
      body: 'Edited body — tighter wording.',
      status: 'PUBLISHED',
      reason: 'Editorial polish',
    });
    req.flush({ data: { ...reviewFixture, rating: 4, status: 'PUBLISHED' } });
  });

  it('updateReview() rejects an empty payload before HTTP call', () => {
    expect(() => service.updateReview(reviewFixture.id, {}).subscribe()).toThrow();
    http.expectNone(`/api/v1/admin/reviews/${reviewFixture.id}`);
  });

  it('updateReview() rejects out-of-range rating before HTTP call', () => {
    expect(() => service.updateReview(reviewFixture.id, { rating: 9 }).subscribe()).toThrow();
    http.expectNone(`/api/v1/admin/reviews/${reviewFixture.id}`);
  });

  it('deleteReview() DELETEs the admin route', (done) => {
    service.deleteReview(reviewFixture.id).subscribe(() => done());
    const req = http.expectOne(`/api/v1/admin/reviews/${reviewFixture.id}`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('listQuestions() GETs /admin/questions', (done) => {
    service.listQuestions({ status: 'PENDING' }).subscribe(() => done());
    http
      .expectOne((r) => r.url === '/api/v1/admin/questions')
      .flush({ data: [questionFixture], meta: { page: 1, pageSize: 20, total: 1 } });
  });

  it('listQuestions() forwards productId + search + sort params', (done) => {
    service
      .listQuestions({
        productId: 'prod-9',
        search: 'return window',
        sortBy: 'helpfulCount',
        sortOrder: 'asc',
      })
      .subscribe(() => done());
    const req = http.expectOne((r) => r.url === '/api/v1/admin/questions');
    expect(req.request.params.get('productId')).toBe('prod-9');
    expect(req.request.params.get('search')).toBe('return window');
    expect(req.request.params.get('sortBy')).toBe('helpfulCount');
    expect(req.request.params.get('sortOrder')).toBe('asc');
    req.flush({ data: [questionFixture], meta: { page: 1, pageSize: 20, total: 1 } });
  });

  it('listQuestions() throws on invalid sortBy before HTTP call', () => {
    expect(() =>
      service
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .listQuestions({ sortBy: 'rating' as any })
        .subscribe(),
    ).toThrow();
    http.expectNone((r) => r.url === '/api/v1/admin/questions');
  });

  it('approveQuestion() PATCHes the action route', (done) => {
    service.approveQuestion(questionFixture.id).subscribe(() => done());
    const req = http.expectOne(`/api/v1/admin/questions/${questionFixture.id}/approve`);
    expect(req.request.method).toBe('PATCH');
    req.flush({ data: { ...questionFixture, status: 'PUBLISHED' } });
  });

  it('rejectQuestion() sends reason when provided', (done) => {
    service.rejectQuestion(questionFixture.id, { reason: 'Off-topic' }).subscribe(() => done());
    const req = http.expectOne(`/api/v1/admin/questions/${questionFixture.id}/reject`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ reason: 'Off-topic' });
    req.flush({ data: { ...questionFixture, status: 'HIDDEN' } });
  });

  it('rejectQuestion() sends {} when reason is omitted', (done) => {
    service.rejectQuestion(questionFixture.id).subscribe(() => done());
    const req = http.expectOne(`/api/v1/admin/questions/${questionFixture.id}/reject`);
    expect(req.request.body).toEqual({});
    req.flush({ data: { ...questionFixture, status: 'HIDDEN' } });
  });

  it('answerQuestion() rejects empty answer', () => {
    expect(() => service.answerQuestion(questionFixture.id, { answer: '' }).subscribe()).toThrow();
    http.expectNone(`/api/v1/admin/questions/${questionFixture.id}/answer`);
  });

  it('answerQuestion() rejects answer > 5000 chars', () => {
    expect(() =>
      service.answerQuestion(questionFixture.id, { answer: 'x'.repeat(5001) }).subscribe(),
    ).toThrow();
    http.expectNone(`/api/v1/admin/questions/${questionFixture.id}/answer`);
  });

  it('answerQuestion() POSTs valid body with isAdminAnswer=true', (done) => {
    service
      .answerQuestion(questionFixture.id, { answer: 'Within 30 days.', isAdminAnswer: true })
      .subscribe(() => done());
    const req = http.expectOne(`/api/v1/admin/questions/${questionFixture.id}/answer`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ answer: 'Within 30 days.', isAdminAnswer: true });
    req.flush({
      data: {
        ...questionFixture,
        answer: { default: 'Within 30 days.', en: 'Within 30 days.' },
        status: 'PUBLISHED',
      },
    });
  });

  it('answerQuestion() forwards isAdminAnswer=false in the body', (done) => {
    service
      .answerQuestion(questionFixture.id, { answer: 'Signed by partner.', isAdminAnswer: false })
      .subscribe(() => done());
    const req = http.expectOne(`/api/v1/admin/questions/${questionFixture.id}/answer`);
    expect(req.request.body).toEqual({ answer: 'Signed by partner.', isAdminAnswer: false });
    req.flush({
      data: {
        ...questionFixture,
        answer: { default: 'Signed by partner.', en: 'Signed by partner.' },
        status: 'PUBLISHED',
      },
    });
  });

  it('answerQuestion() omits isAdminAnswer when not provided', (done) => {
    service.answerQuestion(questionFixture.id, { answer: 'No flag.' }).subscribe(() => done());
    const req = http.expectOne(`/api/v1/admin/questions/${questionFixture.id}/answer`);
    expect(req.request.body).toEqual({ answer: 'No flag.' });
    expect(req.request.body).not.toHaveProperty('isAdminAnswer');
    req.flush({
      data: {
        ...questionFixture,
        answer: { default: 'No flag.', en: 'No flag.' },
        status: 'PUBLISHED',
      },
    });
  });
});
