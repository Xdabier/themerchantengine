import { describe, expect, it } from 'vitest';
import {
  forgotPasswordRequestSchema,
  loginRequestSchema,
  magicLinkRequestSchema,
  registerRequestSchema,
  resetPasswordRequestSchema,
} from './auth.schemas';

describe('registerRequestSchema', () => {
  it('accepts a complete payload', () => {
    expect(() =>
      registerRequestSchema.parse({
        email: 'a@b.co',
        password: 'Aa1aaaaa',
        firstName: 'Jane',
        lastName: 'Doe',
      }),
    ).not.toThrow();
  });

  it('rejects a weak password', () => {
    expect(() =>
      registerRequestSchema.parse({
        email: 'a@b.co',
        password: 'short',
        firstName: 'Jane',
        lastName: 'Doe',
      }),
    ).toThrow();
  });

  it('rejects an invalid email', () => {
    expect(() =>
      registerRequestSchema.parse({
        email: 'not-email',
        password: 'Aa1aaaaa',
        firstName: 'Jane',
        lastName: 'Doe',
      }),
    ).toThrow();
  });
});

describe('loginRequestSchema', () => {
  it('accepts valid credentials', () => {
    expect(() => loginRequestSchema.parse({ email: 'a@b.co', password: 'pw' })).not.toThrow();
  });

  it('rejects empty password', () => {
    expect(() => loginRequestSchema.parse({ email: 'a@b.co', password: '' })).toThrow();
  });
});

describe('forgotPasswordRequestSchema', () => {
  it('accepts a valid email', () => {
    expect(() => forgotPasswordRequestSchema.parse({ email: 'a@b.co' })).not.toThrow();
  });

  it('rejects missing email', () => {
    expect(() => forgotPasswordRequestSchema.parse({})).toThrow();
  });
});

describe('resetPasswordRequestSchema', () => {
  it('accepts a valid token + strong password', () => {
    expect(() =>
      resetPasswordRequestSchema.parse({ token: 'tok', password: 'Aa1aaaaa' }),
    ).not.toThrow();
  });

  it('rejects empty token', () => {
    expect(() => resetPasswordRequestSchema.parse({ token: '', password: 'Aa1aaaaa' })).toThrow();
  });

  it('rejects a weak password', () => {
    expect(() => resetPasswordRequestSchema.parse({ token: 'tok', password: 'short' })).toThrow();
  });
});

describe('magicLinkRequestSchema', () => {
  it('accepts a valid email', () => {
    expect(() => magicLinkRequestSchema.parse({ email: 'a@b.co' })).not.toThrow();
  });

  it('rejects an invalid email', () => {
    expect(() => magicLinkRequestSchema.parse({ email: 'not-email' })).toThrow();
  });
});
