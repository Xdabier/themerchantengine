import {
  signNewsletterConfirmToken,
  verifyNewsletterConfirmToken,
  signSubscriberUnsubscribeToken,
  verifySubscriberUnsubscribeToken,
} from './newsletter-token.util';

const SECRET = 'newsletter-token-test-secret-0123456789';

describe('newsletter confirm token', () => {
  it('round-trips a confirm token', () => {
    const token = signNewsletterConfirmToken('sub_1', SECRET);
    expect(verifyNewsletterConfirmToken(token, SECRET)).toBe('sub_1');
  });

  it('rejects a tampered token', () => {
    const token = signNewsletterConfirmToken('sub_1', SECRET);
    expect(verifyNewsletterConfirmToken(token + 'x', SECRET)).toBeNull();
  });

  it('rejects a wrong-secret token', () => {
    const token = signNewsletterConfirmToken('sub_1', SECRET);
    expect(verifyNewsletterConfirmToken(token, 'other-secret')).toBeNull();
  });

  it('rejects malformed input', () => {
    expect(verifyNewsletterConfirmToken('', SECRET)).toBeNull();
    expect(verifyNewsletterConfirmToken('a.b.c', SECRET)).toBeNull();
  });
});

describe('subscriber unsubscribe token', () => {
  it('round-trips an unsubscribe token', () => {
    const token = signSubscriberUnsubscribeToken('sub_9', SECRET);
    expect(verifySubscriberUnsubscribeToken(token, SECRET)).toBe('sub_9');
  });

  it('cannot be replayed as a confirm token (distinct namespace)', () => {
    const unsub = signSubscriberUnsubscribeToken('sub_9', SECRET);
    expect(verifyNewsletterConfirmToken(unsub, SECRET)).toBeNull();
  });

  it('a confirm token cannot be replayed as an unsubscribe token', () => {
    const confirm = signNewsletterConfirmToken('sub_9', SECRET);
    expect(verifySubscriberUnsubscribeToken(confirm, SECRET)).toBeNull();
  });
});
