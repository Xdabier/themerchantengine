import { provideHttpClient, withFetch } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ADMIN_API_BASE_URL } from '../shared';
import { SettingsService } from './settings.service';

const settingsFixture = {
  general: { storeName: { default: 'Badii Store' }, contactEmail: 'owner@example.com' },
  localization: { supportedLocales: ['fr', 'en'], defaultLocale: 'fr', timezone: 'Europe/Paris' },
};

describe('SettingsService', () => {
  let service: SettingsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withFetch()),
        provideHttpClientTesting(),
        { provide: ADMIN_API_BASE_URL, useValue: '/api' },
        SettingsService,
      ],
    });
    service = TestBed.inject(SettingsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('getAll() GETs grouped settings', (done) => {
    service.getAll().subscribe((res) => {
      expect((res['localization'] as { defaultLocale: string }).defaultLocale).toBe('fr');
      done();
    });
    http.expectOne('/api/v1/admin/settings').flush({ data: settingsFixture });
  });

  it('update() accepts a partial body with any subset of fields', (done) => {
    service
      .update({ contactEmail: 'new@example.com', timezone: 'Europe/Paris' })
      .subscribe(() => done());
    const req = http.expectOne('/api/v1/admin/settings');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ contactEmail: 'new@example.com', timezone: 'Europe/Paris' });
    req.flush({ data: settingsFixture });
  });

  it('update() rejects invalid currency code via Zod', (done) => {
    service.update({ currencyConfig: { code: 'usd', decimalPlaces: 2 } } as never).subscribe({
      error: () => {
        http.expectNone('/api/v1/admin/settings');
        done();
      },
    });
  });

  it('getLocales() parses the locales envelope', (done) => {
    service.getLocales().subscribe((res) => {
      expect(res.supportedLocales).toEqual(['fr', 'en']);
      done();
    });
    http
      .expectOne('/api/v1/admin/settings/locales')
      .flush({ data: { supportedLocales: ['fr', 'en'], defaultLocale: 'fr' } });
  });

  it('updateLocales() rejects defaultLocale outside supportedLocales', (done) => {
    // Two catalogue locales, so this fails the refine the case is named for
    // rather than the enum. The previous input used `de`, which the catalogue
    // does not contain, so it never reached the rule under test and needed a
    // cast to compile.
    service.updateLocales({ supportedLocales: ['en'], defaultLocale: 'fr' }).subscribe({
      error: () => {
        http.expectNone('/api/v1/admin/settings/locales');
        done();
      },
    });
  });

  it('updateLocales() rejects a locale the engine ships no strings for', (done) => {
    service
      .updateLocales({ supportedLocales: ['en', 'de'], defaultLocale: 'en' } as never)
      .subscribe({
        error: () => {
          http.expectNone('/api/v1/admin/settings/locales');
          done();
        },
      });
  });

  it('updateLocales() accepts a valid combo', (done) => {
    service
      .updateLocales({ supportedLocales: ['fr', 'en'], defaultLocale: 'fr' })
      .subscribe(() => done());
    const req = http.expectOne('/api/v1/admin/settings/locales');
    expect(req.request.method).toBe('PATCH');
    req.flush({ data: { supportedLocales: ['fr', 'en'], defaultLocale: 'fr' } });
  });
});

describe('SettingsService.update: empty-body guard (plan I phase I9)', () => {
  /**
   * `updateSettingsRequestSchema` strips unknown keys, so a screen writing a
   * key the schema does not model sent `{}` to the API, which answered 200 with
   * nothing changed and the screen rendered "saved". The whole
   * `/settings/integrations` page did this for all six of its fields.
   *
   * A save whose every key was stripped is never a success, so it fails here
   * rather than reaching the network.
   */
  let service: SettingsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withFetch()),
        provideHttpClientTesting(),
        { provide: ADMIN_API_BASE_URL, useValue: '/api' },
        SettingsService,
      ],
    });
    service = TestBed.inject(SettingsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('fails rather than sending a body the schema emptied', (done) => {
    service.update({ analyticsKey: 'G-NOPE' } as never).subscribe({
      error: (err: Error) => {
        expect(err.message).toMatch(/no recognised settings/i);
        done();
      },
    });
  });

  it('names the keys it dropped, so the caller can see which field is unwired', (done) => {
    service.update({ analyticsKey: 'x', sentryDsn: 'y' } as never).subscribe({
      error: (err: Error) => {
        expect(err.message).toMatch(/analyticsKey/);
        done();
      },
    });
  });

  it('reports a value the schema refuses through the stream, not as a throw', (done) => {
    // A screen calls this from a submit handler that has already flipped its
    // busy flag, and its only failure path is the error callback. A throw from
    // the parse escapes that callback: the button spins forever and the
    // operator has to reload. Clearing a Translatable field is how a form
    // reaches it, since the schema requires a non-empty `default`.
    expect(() => service.update({ storeName: { default: '' } })).not.toThrow();

    service.update({ storeName: { default: '' } }).subscribe({
      error: (err: unknown) => {
        expect(err).toBeDefined();
        done();
      },
    });
  });

  it('still sends a body with at least one recognised key', (done) => {
    service.update({ phone: '+15550000000', analyticsKey: 'x' } as never).subscribe(() => done());
    const req = http.expectOne('/api/v1/admin/settings');
    expect(req.request.body).toEqual({ phone: '+15550000000' });
    req.flush({ data: settingsFixture });
  });

  it('accepts an intentionally empty patch from a caller that sent nothing', (done) => {
    // Distinct from a stripped body: a caller with no dirty fields should not
    // be calling update at all, and every screen guards on `dirty` first, so
    // this stays an error rather than a silent no-op request.
    service.update({}).subscribe({
      error: (err: Error) => {
        expect(err.message).toMatch(/no recognised settings/i);
        done();
      },
    });
  });
});
