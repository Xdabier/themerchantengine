import { HttpClient, HttpContext, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ADMIN_RAW_LOCALE } from '@admin-services';
import { acceptLanguageInterceptor } from './accept-language.interceptor';
import { AuthStore } from '../stores/auth.store';

describe('acceptLanguageInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let store: AuthStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([acceptLanguageInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    store = TestBed.inject(AuthStore);
  });

  afterEach(() => httpMock.verify());

  it('sets Accept-Language from AuthStore.locale', () => {
    store.setLocale('en');
    http.get('/api/anything').subscribe();
    const req = httpMock.expectOne('/api/anything');
    expect(req.request.headers.get('Accept-Language')).toBe('en');
    req.flush(null);
  });

  it('defaults to the bootstrap locale (fr) when no override', () => {
    http.get('/api/anything').subscribe();
    const req = httpMock.expectOne('/api/anything');
    expect(req.request.headers.get('Accept-Language')).toBe('fr');
    req.flush(null);
  });

  it('respects a caller-supplied Accept-Language', () => {
    store.setLocale('fr');
    http.get('/api/anything', { headers: { 'Accept-Language': 'en' } }).subscribe();
    const req = httpMock.expectOne('/api/anything');
    expect(req.request.headers.get('Accept-Language')).toBe('en');
    req.flush(null);
  });

  it('attaches X-Resolve-Locale: false by default (ADMIN_RAW_LOCALE)', () => {
    http.get('/api/anything').subscribe();
    const req = httpMock.expectOne('/api/anything');
    expect(req.request.headers.get('X-Resolve-Locale')).toBe('false');
    req.flush(null);
  });

  it('omits X-Resolve-Locale when the ADMIN_RAW_LOCALE context is false', () => {
    http
      .get('/api/anything', { context: new HttpContext().set(ADMIN_RAW_LOCALE, false) })
      .subscribe();
    const req = httpMock.expectOne('/api/anything');
    expect(req.request.headers.has('X-Resolve-Locale')).toBe(false);
    req.flush(null);
  });

  it('does not override a caller-supplied X-Resolve-Locale', () => {
    http.get('/api/anything', { headers: { 'X-Resolve-Locale': 'true' } }).subscribe();
    const req = httpMock.expectOne('/api/anything');
    expect(req.request.headers.get('X-Resolve-Locale')).toBe('true');
    req.flush(null);
  });
});
