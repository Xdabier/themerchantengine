import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CustomerUser } from '@storefront-types';

import { AuthStateService } from './auth-state.service';

const SAMPLE_USER: CustomerUser = {
  id: 'cus_01HX9TJ4ZK',
  email: 'fx-customer@auth.test',
  firstName: 'Aisha',
  lastName: 'Karim',
  phone: null,
  avatarUrl: null,
  locale: 'fr',
  addresses: [],
};

describe('AuthStateService', () => {
  let setItemSpy: ReturnType<typeof vi.spyOn>;
  let sessionSetItemSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    setItemSpy = vi.spyOn(globalThis.localStorage, 'setItem');
    sessionSetItemSpy = vi.spyOn(globalThis.sessionStorage, 'setItem');
  });

  afterEach(() => {
    setItemSpy.mockRestore();
    sessionSetItemSpy.mockRestore();
  });

  it('boots anonymous (currentUser null, isAuthed false)', () => {
    const svc = TestBed.inject(AuthStateService);
    expect(svc.currentUser()).toBeNull();
    expect(svc.isAuthed()).toBe(false);
  });

  it('setSession publishes the user and flips isAuthed to true', () => {
    const svc = TestBed.inject(AuthStateService);
    svc.setSession({ user: SAMPLE_USER });
    expect(svc.currentUser()).toEqual(SAMPLE_USER);
    expect(svc.isAuthed()).toBe(true);
  });

  it('clearSession resets currentUser to null and isAuthed back to false', () => {
    const svc = TestBed.inject(AuthStateService);
    svc.setSession({ user: SAMPLE_USER });
    svc.clearSession();
    expect(svc.currentUser()).toBeNull();
    expect(svc.isAuthed()).toBe(false);
  });

  it('never writes the session to localStorage or sessionStorage', () => {
    const svc = TestBed.inject(AuthStateService);
    svc.setSession({ user: SAMPLE_USER });
    svc.clearSession();
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(sessionSetItemSpy).not.toHaveBeenCalled();
  });

  it('exposes currentUser as a read-only signal', () => {
    const svc = TestBed.inject(AuthStateService);
    expect((svc.currentUser as unknown as { set?: unknown }).set).toBeUndefined();
  });

  /**
   * Finding N4. Consumers used to read `isAuthed()` synchronously while the
   * shell's `getSession()` was still in flight, so a valid customer looked
   * anonymous for the length of one round trip. `whenBooted()` is the boot
   * OUTCOME every consumer waits on; it resolves for a committed session and
   * for a null one alike, because both are settled answers.
   */
  describe('boot outcome', () => {
    it('starts pending', () => {
      const svc = TestBed.inject(AuthStateService);
      expect(svc.bootState()).toBe('pending');
    });

    it('whenBooted stays unresolved until markBooted runs', async () => {
      const svc = TestBed.inject(AuthStateService);
      let resolved = false;
      void svc.whenBooted().then(() => {
        resolved = true;
      });
      await Promise.resolve();
      expect(resolved).toBe(false);

      svc.markBooted();
      await svc.whenBooted();
      expect(resolved).toBe(true);
      expect(svc.bootState()).toBe('booted');
    });

    it('resolves immediately once already booted', async () => {
      const svc = TestBed.inject(AuthStateService);
      svc.markBooted();
      await expect(svc.whenBooted()).resolves.toBeUndefined();
    });

    it('resolves after a boot that committed no session', async () => {
      const svc = TestBed.inject(AuthStateService);
      svc.markBooted();
      await svc.whenBooted();
      expect(svc.isAuthed()).toBe(false);
    });

    it('transitions pending to booted exactly once', () => {
      const svc = TestBed.inject(AuthStateService);
      svc.markBooted();
      svc.markBooted();
      expect(svc.bootState()).toBe('booted');
    });

    it('exposes bootState as a read-only signal', () => {
      const svc = TestBed.inject(AuthStateService);
      expect((svc.bootState as unknown as { set?: unknown }).set).toBeUndefined();
    });
  });
});
