import { TestBed } from '@angular/core/testing';
import { Observable } from 'rxjs';
import { SettingsService, type SettingsResponse } from '@admin-services';
import { AuthStore } from '../../core/stores/auth.store';
import { BOOTSTRAP_LOCALE } from '../../core/tokens';
import { StoreSettingsStore } from '../../core/stores/store-settings.store';
import { AdminDatePipe } from './admin-date.pipe';

const ISO = '2026-05-24T11:15:00.000Z';

function makeUser() {
  return {
    id: 'u1',
    email: 'admin@merchants.test',
    firstName: 'A',
    lastName: 'B',
    role: 'SUPER_ADMIN',
    permissions: [],
    isActive: true,
  } as never;
}

describe('AdminDatePipe', () => {
  let pipe: AdminDatePipe;
  let auth: AuthStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: BOOTSTRAP_LOCALE, useValue: 'fr' },
        {
          provide: SettingsService,
          useValue: {
            getAll: () =>
              new Observable<SettingsResponse>((s) => {
                s.next({ localization: { timezone: 'Europe/Paris' } } as SettingsResponse);
                s.complete();
              }),
          },
        },
        AdminDatePipe,
      ],
    });
    pipe = TestBed.inject(AdminDatePipe);
    auth = TestBed.inject(AuthStore);
    TestBed.inject(StoreSettingsStore);
  });

  function hydrate(): void {
    auth.setSession({ user: makeUser() });
    TestBed.flushEffects();
  }

  it('renders UTC before the store settings land', () => {
    expect(pipe.transform(ISO)).toBe('24 May 2026, 11:15');
  });

  it('re-renders in the store timezone once settings hydrate', () => {
    expect(pipe.transform(ISO)).toBe('24 May 2026, 11:15');
    hydrate();
    expect(pipe.transform(ISO)).toBe('24 May 2026, 13:15');
  });

  it('supports the date-only format', () => {
    hydrate();
    expect(pipe.transform(ISO, 'date')).toBe('24 May 2026');
  });

  it('supports the forensic format', () => {
    hydrate();
    expect(pipe.transform('2026-05-24T02:32:42.000Z', 'forensic')).toBe(
      '24 May 2026, 04:32:42 GMT+2',
    );
  });

  it('renders the placeholder for nullish input', () => {
    expect(pipe.transform(null)).toBe('—');
    expect(pipe.transform(undefined)).toBe('—');
  });

  it('memoizes on value, format and timezone', () => {
    hydrate();
    expect(pipe.transform(ISO)).toBe('24 May 2026, 13:15');
    expect(pipe.transform(ISO)).toBe('24 May 2026, 13:15');
    expect(pipe.transform(ISO, 'date')).toBe('24 May 2026');
    expect(pipe.transform(ISO)).toBe('24 May 2026, 13:15');
  });
});
