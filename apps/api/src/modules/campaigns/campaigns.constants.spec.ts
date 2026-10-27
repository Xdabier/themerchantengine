import {
  CAMPAIGN_QUEUE,
  WINBACK_QUEUE,
  CAMPAIGN_BATCH_SIZE,
  CAMPAIGN_RATE_LIMITER,
  SUBSCRIBER_LOCALES,
} from './campaigns.constants';
import { MAIL_QUEUE, MAIL_RATE_LIMITER } from '../mail/mail.constants';
import { MAIL_LOCALES } from '../mail/mail.types';

describe('campaign queue isolation (Risk R9)', () => {
  it('uses queues distinct from the transactional mail queue', () => {
    expect(CAMPAIGN_QUEUE).not.toBe(MAIL_QUEUE);
    expect(WINBACK_QUEUE).not.toBe(MAIL_QUEUE);
    expect(CAMPAIGN_QUEUE).toBe('campaign');
  });

  it('has its own rate budget separate from the transactional limiter', () => {
    // A campaign burst is paced by its own limiter; it cannot consume the
    // transactional 5 req/s budget.
    expect(CAMPAIGN_RATE_LIMITER).not.toBe(MAIL_RATE_LIMITER);
    expect(CAMPAIGN_BATCH_SIZE).toBe(100);
  });
});

describe('subscriber locales', () => {
  // The double opt-in mail renders in the subscriber's own locale since D7, so a
  // storefront locale with no template copy would be silently coerced to the
  // store default instead of speaking the language the visitor signed up in.
  it('every storefront signup locale has mail copy', () => {
    for (const locale of SUBSCRIBER_LOCALES) {
      expect(MAIL_LOCALES).toContain(locale);
    }
  });
});
