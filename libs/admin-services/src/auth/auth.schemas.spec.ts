import {
  passwordPolicy,
  loginRequestSchema,
  forgotPasswordRequestSchema,
  resetPasswordRequestSchema,
  magicLinkRequestSchema,
  totpCodeSchema,
} from './auth.schemas';

describe('auth.schemas', () => {
  describe('passwordPolicy', () => {
    it('rejects a 7-character password (below the minimum)', () => {
      expect(passwordPolicy.safeParse('Abcdef1').success).toBe(false);
    });

    it('accepts an 8-character password meeting every class', () => {
      expect(passwordPolicy.safeParse('Abcdefg1').success).toBe(true);
    });

    it('accepts a 128-character password', () => {
      const pw = `Aa1${'x'.repeat(125)}`;
      expect(pw.length).toBe(128);
      expect(passwordPolicy.safeParse(pw).success).toBe(true);
    });

    it('rejects a 129-character password (above the maximum)', () => {
      const pw = `Aa1${'x'.repeat(126)}`;
      expect(pw.length).toBe(129);
      expect(passwordPolicy.safeParse(pw).success).toBe(false);
    });

    it('rejects a password with no uppercase letter', () => {
      expect(passwordPolicy.safeParse('abcdefg1').success).toBe(false);
    });

    it('rejects a password with no lowercase letter', () => {
      expect(passwordPolicy.safeParse('ABCDEFG1').success).toBe(false);
    });

    it('rejects a password with no digit', () => {
      expect(passwordPolicy.safeParse('Abcdefgh').success).toBe(false);
    });
  });

  describe('loginRequestSchema', () => {
    it('accepts a valid email + password', () => {
      expect(loginRequestSchema.safeParse({ email: 'a@b.co', password: 'x' }).success).toBe(true);
    });

    it('rejects a malformed email', () => {
      expect(loginRequestSchema.safeParse({ email: 'nope', password: 'x' }).success).toBe(false);
    });

    it('rejects an empty password', () => {
      expect(loginRequestSchema.safeParse({ email: 'a@b.co', password: '' }).success).toBe(false);
    });
  });

  describe('forgotPasswordRequestSchema', () => {
    it('accepts a valid email', () => {
      expect(forgotPasswordRequestSchema.safeParse({ email: 'a@b.co' }).success).toBe(true);
    });

    it('rejects a malformed email', () => {
      expect(forgotPasswordRequestSchema.safeParse({ email: 'nope' }).success).toBe(false);
    });
  });

  describe('resetPasswordRequestSchema', () => {
    it('accepts a token + policy-compliant password', () => {
      expect(
        resetPasswordRequestSchema.safeParse({ token: 'tok', password: 'Abcdefg1' }).success,
      ).toBe(true);
    });

    it('rejects an empty token', () => {
      expect(
        resetPasswordRequestSchema.safeParse({ token: '', password: 'Abcdefg1' }).success,
      ).toBe(false);
    });

    it('rejects a weak password', () => {
      expect(resetPasswordRequestSchema.safeParse({ token: 'tok', password: 'weak' }).success).toBe(
        false,
      );
    });
  });

  describe('magicLinkRequestSchema', () => {
    it('accepts a valid email', () => {
      expect(magicLinkRequestSchema.safeParse({ email: 'a@b.co' }).success).toBe(true);
    });

    it('rejects a malformed email', () => {
      expect(magicLinkRequestSchema.safeParse({ email: 'nope' }).success).toBe(false);
    });
  });

  describe('totpCodeSchema', () => {
    it('accepts a 6-digit code', () => {
      expect(totpCodeSchema.safeParse('123456').success).toBe(true);
    });

    it('rejects a 5-digit code', () => {
      expect(totpCodeSchema.safeParse('12345').success).toBe(false);
    });

    it('rejects a 7-digit code', () => {
      expect(totpCodeSchema.safeParse('1234567').success).toBe(false);
    });

    it('rejects a non-numeric code', () => {
      expect(totpCodeSchema.safeParse('12345a').success).toBe(false);
    });
  });
});
