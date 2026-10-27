import { NotificationPreferenceService } from './notification-preference.service';
import { signUnsubscribeToken } from './unsubscribe-token.util';

const SECRET = 'pref-svc-test-secret-0123456789'; // gitleaks:allow

function makePrisma() {
  return {
    user: { findUnique: jest.fn() },
    notificationPreference: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
  };
}

function makeConfig(overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    UNSUBSCRIBE_TOKEN_SECRET: SECRET,
    API_PUBLIC_BASE_URL: 'https://api.example.test',
    API_GLOBAL_PREFIX: 'api',
    STOREFRONT_PUBLIC_BASE_URL: 'https://shop.example.test',
    ...overrides,
  };
  return { get: jest.fn((k: string, d?: string) => values[k] ?? d) };
}

describe('NotificationPreferenceService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let config: ReturnType<typeof makeConfig>;
  let service: NotificationPreferenceService;

  beforeEach(() => {
    prisma = makePrisma();
    config = makeConfig();
    service = new NotificationPreferenceService(prisma as never, config as never);
  });

  describe('resolveEmailConsent (opt-in required)', () => {
    it('returns not-consented + null userId when the recipient has no account', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.resolveEmailConsent('guest@x.com', 'LIFECYCLE')).resolves.toEqual({
        userId: null,
        consented: false,
      });
      expect(prisma.notificationPreference.findUnique).not.toHaveBeenCalled();
    });

    it('returns not-consented when no preference row exists (absent = opt-out)', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
      prisma.notificationPreference.findUnique.mockResolvedValue(null);
      await expect(service.resolveEmailConsent('u@x.com', 'LIFECYCLE')).resolves.toEqual({
        userId: 'u1',
        consented: false,
      });
    });

    it('returns not-consented when the row has email:false', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
      prisma.notificationPreference.findUnique.mockResolvedValue({ email: false });
      await expect(service.resolveEmailConsent('u@x.com', 'MARKETING')).resolves.toEqual({
        userId: 'u1',
        consented: false,
      });
    });

    it('returns consented when the row has email:true', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
      prisma.notificationPreference.findUnique.mockResolvedValue({ email: true });
      await expect(service.resolveEmailConsent('u@x.com', 'LIFECYCLE')).resolves.toEqual({
        userId: 'u1',
        consented: true,
      });
    });
  });

  describe('getPreferences', () => {
    it('returns an all-off map for the consent categories when no rows exist', async () => {
      prisma.notificationPreference.findMany.mockResolvedValue([]);
      await expect(service.getPreferences('u1')).resolves.toEqual({
        LIFECYCLE: { email: false, sms: false, push: false },
        MARKETING: { email: false, sms: false, push: false },
      });
    });

    it('reflects stored rows per category', async () => {
      prisma.notificationPreference.findMany.mockResolvedValue([
        { category: 'LIFECYCLE', email: true, sms: false, push: false },
      ]);
      await expect(service.getPreferences('u1')).resolves.toEqual({
        LIFECYCLE: { email: true, sms: false, push: false },
        MARKETING: { email: false, sms: false, push: false },
      });
    });
  });

  describe('updatePreferences', () => {
    it('upserts only the supplied categories, reviving deletedAt', async () => {
      prisma.notificationPreference.upsert.mockResolvedValue({});
      prisma.notificationPreference.findMany.mockResolvedValue([
        { category: 'MARKETING', email: true, sms: false, push: false },
      ]);
      await service.updatePreferences('u1', { MARKETING: { email: true } });
      expect(prisma.notificationPreference.upsert).toHaveBeenCalledTimes(1);
      const call = prisma.notificationPreference.upsert.mock.calls[0][0];
      expect(call.where).toEqual({ userId_category: { userId: 'u1', category: 'MARKETING' } });
      expect(call.update).toEqual({ email: true, deletedAt: null });
      expect(call.create).toEqual({
        userId: 'u1',
        category: 'MARKETING',
        email: true,
        sms: false,
        push: false,
      });
    });
  });

  describe('buildUnsubscribeUrl + optOut', () => {
    it('builds a verifiable one-click URL against the API base with the send locale', () => {
      const url = service.buildUnsubscribeUrl('u1', 'MARKETING', 'fr');
      // Must carry the API global prefix (/api), a bare /v1/... link 404s on
      // prod (regression found in prod verification 2026-06-23).
      expect(url.startsWith('https://api.example.test/api/v1/unsubscribe?token=')).toBe(true);
      expect(url).toContain('locale=fr');
    });

    it('carries the en locale through unchanged', () => {
      expect(service.buildUnsubscribeUrl('u1', 'MARKETING', 'en')).toContain('locale=en');
    });

    it('optOut flips email:false for a valid token and returns the category', async () => {
      prisma.notificationPreference.upsert.mockResolvedValue({});
      const token = signUnsubscribeToken('u1', 'MARKETING', SECRET);
      await expect(service.optOut(token)).resolves.toEqual({ category: 'MARKETING' });
      const call = prisma.notificationPreference.upsert.mock.calls[0][0];
      expect(call.update).toEqual({ email: false, deletedAt: null });
    });

    it('optOut returns null and changes nothing for an invalid token', async () => {
      await expect(service.optOut('garbage.token.here')).resolves.toBeNull();
      expect(prisma.notificationPreference.upsert).not.toHaveBeenCalled();
    });
  });
});
