import { isHoneypotTripped, HONEYPOT_HEADER, SIGNUP_PATH } from './signup-hardening';

describe('signup-hardening honeypot', () => {
  it('trips when the sign-up path carries a non-empty honeypot', () => {
    expect(isHoneypotTripped(SIGNUP_PATH, 'i-am-a-bot')).toBe(true);
    expect(isHoneypotTripped(SIGNUP_PATH, '  spaced  ')).toBe(true);
  });

  it('does not trip on an empty / absent honeypot (real users)', () => {
    expect(isHoneypotTripped(SIGNUP_PATH, '')).toBe(false);
    expect(isHoneypotTripped(SIGNUP_PATH, '   ')).toBe(false);
    expect(isHoneypotTripped(SIGNUP_PATH, null)).toBe(false);
    expect(isHoneypotTripped(SIGNUP_PATH, undefined)).toBe(false);
  });

  it('only applies to the sign-up path', () => {
    expect(isHoneypotTripped('/sign-in/email', 'anything')).toBe(false);
    expect(isHoneypotTripped('/request-password-reset', 'anything')).toBe(false);
  });

  it('exposes the header name contract', () => {
    expect(HONEYPOT_HEADER).toBe('x-hp-field');
  });
});
