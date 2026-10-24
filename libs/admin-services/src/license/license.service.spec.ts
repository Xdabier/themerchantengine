import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ADMIN_API_BASE_URL } from '../shared';
import { LicenseService } from './license.service';
import { type LicenseVerdict, isLicenseWarning } from './license.schemas';

/**
 * Plan E3.5.1. The verdict has six statuses and the admin has to render all of
 * them: a schema that modelled only the happy one would throw on exactly the
 * response an operator whose license is expiring most needs to read, which is
 * the schema-drift failure that surfaces as "Could not load".
 */
const CLAIMS = {
  id: 'lic-1',
  licensee: 'Demo Agency',
  plan: 'studio',
  storeCap: 5,
  domains: ['example.com'],
  issuedAt: '2026-01-01T00:00:00.000Z',
  expiresAt: '2027-01-01T00:00:00.000Z',
};

function verdict(overrides: Partial<LicenseVerdict> = {}): LicenseVerdict {
  return {
    status: 'valid',
    claims: CLAIMS,
    reason: null,
    verifiedAt: '2026-09-05T00:00:00.000Z',
    graceEndsAt: null,
    daysToExpiry: 118,
    ...overrides,
  } as LicenseVerdict;
}

describe('LicenseService', () => {
  let service: LicenseService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ADMIN_API_BASE_URL, useValue: '/api' },
        LicenseService,
      ],
    });
    service = TestBed.inject(LicenseService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('reads the boot verdict', (done) => {
    service.current().subscribe((result) => {
      expect(result.status).toBe('valid');
      expect(result.claims?.licensee).toBe('Demo Agency');
      done();
    });
    const req = http.expectOne('/api/v1/admin/license');
    expect(req.request.method).toBe('GET');
    req.flush({ data: verdict() });
  });

  it('asks the engine to re-verify the file when told to', (done) => {
    service.current(true).subscribe(() => done());
    const req = http.expectOne('/api/v1/admin/license?fresh=1');
    req.flush({ data: verdict() });
  });

  it.each([
    ['expiring', 12, '2027-02-01T00:00:00.000Z'],
    ['grace', -3, '2027-01-31T00:00:00.000Z'],
    ['expired', -45, '2027-01-31T00:00:00.000Z'],
  ])('parses the %s verdict with its expiry fields', (status, days, graceEndsAt, done) => {
    service.current().subscribe((result) => {
      expect(result.status).toBe(status);
      expect(result.daysToExpiry).toBe(days);
      expect(result.graceEndsAt).toBe(graceEndsAt);
      (done as jest.DoneCallback)();
    });
    http.expectOne('/api/v1/admin/license').flush({
      data: verdict({
        status: status as LicenseVerdict['status'],
        daysToExpiry: days,
        graceEndsAt,
      }),
    });
  });

  it('parses an invalid verdict, which carries a reason and no claims', (done) => {
    service.current().subscribe((result) => {
      expect(result.status).toBe('invalid');
      expect(result.claims).toBeNull();
      expect(result.reason).toContain('signature');
      done();
    });
    http.expectOne('/api/v1/admin/license').flush({
      data: verdict({
        status: 'invalid',
        claims: null,
        reason: 'The signature does not verify against the engine key.',
        daysToExpiry: null,
      }),
    });
  });

  it('parses a missing verdict, which is an install with no license at all', (done) => {
    service.current().subscribe((result) => {
      expect(result.status).toBe('missing');
      expect(result.claims).toBeNull();
      done();
    });
    http.expectOne('/api/v1/admin/license').flush({
      data: verdict({
        status: 'missing',
        claims: null,
        reason: 'No license file is configured.',
        daysToExpiry: null,
      }),
    });
  });

  it('sends the operator file as bytes, without reading or re-encoding it', (done) => {
    // The browser never parses the license. Reading it to validate the JSON
    // before upload would be a step that can only lose bytes, and the
    // signature covers the exact document the vendor issued.
    const file = new File(['{"claims":{},"signature":"x"}'], 'engine.license.json', {
      type: 'application/json',
    });

    service.install(file).subscribe(() => done());

    const req = http.expectOne('/api/v1/admin/license/install');
    expect(req.request.method).toBe('POST');
    const body = req.request.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('file')).toBe(file);
    // The browser sets the multipart boundary; a hand-set header breaks it.
    expect(req.request.headers.has('Content-Type')).toBe(false);
    req.flush({ data: verdict() });
  });

  it('parses the verdict the install answers with', (done) => {
    service.install(new File(['{}'], 'engine.license.json')).subscribe((result) => {
      expect(result.status).toBe('expiring');
      done();
    });
    http
      .expectOne('/api/v1/admin/license/install')
      .flush({ data: verdict({ status: 'expiring', daysToExpiry: 9 }) });
  });

  it('refuses a status the engine does not define', (done) => {
    // A new status the admin has never heard of is a contract change, and
    // silently rendering it as valid would hide it.
    service.current().subscribe({
      error: () => done(),
    });
    http.expectOne('/api/v1/admin/license').flush({ data: verdict({ status: 'lapsed' as never }) });
  });
});

describe('isLicenseWarning', () => {
  it('is quiet only for a valid license', () => {
    expect(isLicenseWarning('valid')).toBe(false);
    for (const status of ['expiring', 'grace', 'expired', 'invalid', 'missing'] as const) {
      expect(isLicenseWarning(status)).toBe(true);
    }
  });
});
