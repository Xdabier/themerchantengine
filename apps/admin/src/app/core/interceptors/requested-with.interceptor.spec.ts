import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { requestedWithInterceptor } from './requested-with.interceptor';

describe('requestedWithInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([requestedWithInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('sets X-Requested-With: XMLHttpRequest on every request', () => {
    http.get('/api/x').subscribe();
    const req = httpMock.expectOne('/api/x');
    expect(req.request.headers.get('X-Requested-With')).toBe('XMLHttpRequest');
    req.flush(null);
  });

  it('attaches the header to POST as well', () => {
    http.post('/api/write', {}).subscribe();
    const req = httpMock.expectOne('/api/write');
    expect(req.request.headers.get('X-Requested-With')).toBe('XMLHttpRequest');
    req.flush(null);
  });

  it('respects an explicit caller-supplied value', () => {
    http.get('/api/x', { headers: { 'X-Requested-With': 'custom' } }).subscribe();
    const req = httpMock.expectOne('/api/x');
    expect(req.request.headers.get('X-Requested-With')).toBe('custom');
    req.flush(null);
  });
});
