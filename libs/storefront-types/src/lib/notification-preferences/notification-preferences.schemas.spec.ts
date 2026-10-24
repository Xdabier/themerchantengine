import { describe, expect, it } from 'vitest';
import {
  notificationPreferencesSchema,
  updateNotificationPreferencesRequestSchema,
} from './notification-preferences.schemas';

describe('notification-preferences schemas', () => {
  it('parses a full consent map', () => {
    const parsed = notificationPreferencesSchema.parse({
      LIFECYCLE: { email: true, sms: false, push: false },
      MARKETING: { email: false, sms: false, push: false },
    });
    expect(parsed.LIFECYCLE.email).toBe(true);
  });

  it('rejects a map missing a category', () => {
    expect(() =>
      notificationPreferencesSchema.parse({ LIFECYCLE: { email: true, sms: false, push: false } }),
    ).toThrow();
  });

  it('accepts a partial update with a single channel', () => {
    expect(() =>
      updateNotificationPreferencesRequestSchema.parse({ MARKETING: { email: true } }),
    ).not.toThrow();
  });

  it('rejects an unknown category (strict)', () => {
    expect(() =>
      updateNotificationPreferencesRequestSchema.parse({ PROMOS: { email: true } }),
    ).toThrow();
  });
});
