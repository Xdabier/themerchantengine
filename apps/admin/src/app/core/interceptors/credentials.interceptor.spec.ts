import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { credentialsInterceptor } from './credentials.interceptor';

describe('credentialsInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([credentialsInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('sets withCredentials on a GET so the session cookie rides cross-origin', () => {
    http.get('/api/ping').subscribe();
    const req = httpMock.expectOne('/api/ping');
    expect(req.request.withCredentials).toBe(true);
    req.flush(null);
  });

  it('sets withCredentials on a POST', () => {
    http.post('/api/thing', {}).subscribe();
    const req = httpMock.expectOne('/api/thing');
    expect(req.request.withCredentials).toBe(true);
    req.flush(null);
  });
});
