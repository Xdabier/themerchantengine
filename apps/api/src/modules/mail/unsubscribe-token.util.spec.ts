import {
  resolveUnsubscribeSecret,
  signUnsubscribeToken,
  verifyUnsubscribeToken,
} from './unsubscribe-token.util';

const SECRET = 'test-unsubscribe-secret-0123456789'; // gitleaks:allow

describe('unsubscribe-token.util', () => {
  describe('sign + verify round-trip', () => {
    it('verifies a freshly signed token back to its userId + category', () => {
      const token = signUnsubscribeToken('user_123', 'MARKETING', SECRET);
      expect(verifyUnsubscribeToken(token, SECRET)).toEqual({
        userId: 'user_123',
        category: 'MARKETING',
      });
    });

    it('is deterministic — same inputs produce the same token', () => {
      expect(signUnsubscribeToken('u', 'LIFECYCLE', SECRET)).toBe(
        signUnsubscribeToken('u', 'LIFECYCLE', SECRET),
      );
    });

    it('round-trips ids/categories that need base64url encoding', () => {
      const token = signUnsubscribeToken('cuid-with_underscore', 'LIFECYCLE', SECRET);
      expect(verifyUnsubscribeToken(token, SECRET)).toEqual({
        userId: 'cuid-with_underscore',
        category: 'LIFECYCLE',
      });
    });
  });

  describe('tamper + scope rejection', () => {
    it('rejects a token signed with a different secret', () => {
      const token = signUnsubscribeToken('u', 'MARKETING', SECRET);
      expect(verifyUnsubscribeToken(token, 'a-different-secret')).toBeNull();
    });

    it('rejects a token whose signature byte was flipped', () => {
      const token = signUnsubscribeToken('u', 'MARKETING', SECRET);
      const tampered = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
      expect(verifyUnsubscribeToken(tampered, SECRET)).toBeNull();
    });

    it('is category-scoped — a MARKETING token does not validate as LIFECYCLE', () => {
      // Re-sign the same userId for a different category and compare: the
      // signature embeds the category, so swapping the category segment breaks it.
      const marketing = signUnsubscribeToken('u', 'MARKETING', SECRET);
      const lifecycle = signUnsubscribeToken('u', 'LIFECYCLE', SECRET);
      expect(marketing).not.toBe(lifecycle);
      // Splice the LIFECYCLE category segment onto the MARKETING signature.
      const forged = `${lifecycle.split('.')[0]}.${lifecycle.split('.')[1]}.${
        marketing.split('.')[2]
      }`;
      expect(verifyUnsubscribeToken(forged, SECRET)).toBeNull();
    });

    it.each(['', 'not-a-token', 'a.b', 'a.b.c.d', 'only.two'])(
      'rejects malformed token %p',
      (bad) => {
        expect(verifyUnsubscribeToken(bad, SECRET)).toBeNull();
      },
    );
  });

  describe('resolveUnsubscribeSecret', () => {
    const ORIG = { ...process.env };
    afterEach(() => {
      process.env = { ...ORIG };
    });

    it('prefers an explicit value', () => {
      expect(resolveUnsubscribeSecret('explicit')).toBe('explicit');
    });

    it('falls back to UNSUBSCRIBE_TOKEN_SECRET then BETTER_AUTH_SECRET', () => {
      delete process.env.UNSUBSCRIBE_TOKEN_SECRET;
      process.env.BETTER_AUTH_SECRET = 'ba-secret';
      expect(resolveUnsubscribeSecret()).toBe('ba-secret');
      process.env.UNSUBSCRIBE_TOKEN_SECRET = 'dedicated';
      expect(resolveUnsubscribeSecret()).toBe('dedicated');
    });

    it('throws when no secret is configured', () => {
      delete process.env.UNSUBSCRIBE_TOKEN_SECRET;
      delete process.env.BETTER_AUTH_SECRET;
      expect(() => resolveUnsubscribeSecret()).toThrow(/must be set/);
    });
  });
});
