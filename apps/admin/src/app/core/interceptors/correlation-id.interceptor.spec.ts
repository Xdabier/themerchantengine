import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { correlationIdInterceptor } from './correlation-id.interceptor';

describe('correlationIdInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([correlationIdInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('adds an X-Request-Id header when missing', () => {
    http.get('/api/ping').subscribe();
    const req = httpMock.expectOne('/api/ping');
    const id = req.request.headers.get('X-Request-Id');
    expect(id).toBeTruthy();
    // UUID v4 is 36 chars with dashes; fallback is >=10 chars.
    expect(id!.length).toBeGreaterThanOrEqual(10);
    req.flush(null);
  });

  it('preserves a caller-supplied X-Request-Id', () => {
    http.get('/api/ping', { headers: { 'X-Request-Id': 'supplied-123' } }).subscribe();
    const req = httpMock.expectOne('/api/ping');
    expect(req.request.headers.get('X-Request-Id')).toBe('supplied-123');
    req.flush(null);
  });

  it('generates a distinct id per request', () => {
    const ids: string[] = [];
    http.get('/api/a').subscribe();
    http.get('/api/b').subscribe();
    const [a, b] = ['a', 'b'].map((p) => httpMock.expectOne(`/api/${p}`));
    ids.push(a.request.headers.get('X-Request-Id')!);
    ids.push(b.request.headers.get('X-Request-Id')!);
    expect(ids[0]).not.toBe(ids[1]);
    a.flush(null);
    b.flush(null);
  });
});
