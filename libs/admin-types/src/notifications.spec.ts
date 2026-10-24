import {
  logStatusSchema,
  notificationTemplateSchema,
  notificationLogEntrySchema,
  listLogResponseSchema,
  previewTemplateResponseSchema,
  sendTestResponseSchema,
  adminNotificationSchema,
  notificationTitleText,
  notificationBodyText,
} from './notifications';

describe('notifications schemas', () => {
  describe('logStatusSchema', () => {
    // The full union MUST match the backend NotificationLogStatus — a missing
    // value makes the send-log page "Could not load" (the drift-class bug).
    const statuses = [
      'queued',
      'sent',
      'delivered',
      'bounced',
      'complained',
      'failed',
      'suppressed',
      'skipped',
      'enqueue-failed',
    ];

    it.each(statuses)('accepts the reachable status %s', (status) => {
      expect(() => logStatusSchema.parse(status)).not.toThrow();
    });

    it('rejects an unknown status', () => {
      expect(() => logStatusSchema.parse('exploded')).toThrow();
    });
  });

  describe('notificationTemplateSchema', () => {
    const valid = {
      id: 'tmpl-1',
      code: 'order.shipped',
      subject: { default: 'Expédié', fr: 'Expédié', en: 'Shipped' },
      body: { default: 'Bonjour', fr: 'Bonjour', en: 'Hi' },
      channel: 'email',
      event: 'order.shipped',
      variables: ['orderNumber'],
      isEnabled: true,
    };

    it('parses a valid template without the optional NE1 fields', () => {
      expect(() => notificationTemplateSchema.parse(valid)).not.toThrow();
    });

    it('parses a template carrying sendEnabled + category + isLocked', () => {
      expect(() =>
        notificationTemplateSchema.parse({
          ...valid,
          sendEnabled: false,
          category: 'TRANSACTIONAL',
          isLocked: true,
        }),
      ).not.toThrow();
    });

    it('accepts a null subject (sms/push templates carry none)', () => {
      expect(() => notificationTemplateSchema.parse({ ...valid, subject: null })).not.toThrow();
    });

    it('parses a body/subject with NO default key (the NE3 {en,ar} seed shape)', () => {
      // Real DB rows carry the store's locales with no `default`. The strict
      // translatableSchema would throw and surface "Could not load". The
      // optional-default variant must tolerate it.
      expect(() =>
        notificationTemplateSchema.parse({
          ...valid,
          subject: { fr: 'Expédié', en: 'Shipped' },
          body: { fr: 'Bonjour', en: 'Hi' },
        }),
      ).not.toThrow();
    });

    it('rejects an unknown category', () => {
      expect(() => notificationTemplateSchema.parse({ ...valid, category: 'PROMO' })).toThrow();
    });
  });

  describe('notificationLogEntrySchema + listLogResponseSchema', () => {
    const entry = {
      id: 'log-1',
      templateId: 'tmpl-1',
      templateCode: 'order.shipped',
      channel: 'email',
      recipient: 'a@b.com',
      status: 'enqueue-failed',
      sentAt: '2026-06-18T10:00:00.000Z',
    };

    it('parses a log entry with templateId (NE2 linkage)', () => {
      expect(() => notificationLogEntrySchema.parse(entry)).not.toThrow();
    });

    it('tolerates a null templateId (un-seeded flow)', () => {
      expect(() => notificationLogEntrySchema.parse({ ...entry, templateId: null })).not.toThrow();
    });

    it('parses a paginated log response', () => {
      expect(() =>
        listLogResponseSchema.parse({ data: [entry], meta: { page: 1, pageSize: 20, total: 1 } }),
      ).not.toThrow();
    });
  });

  describe('NE6 preview + send-test', () => {
    it('parses whatever locale set the mail renderer returns', () => {
      // The renderer emits the store's own locales, and that pair has moved. The
      // schema must survive that move rather than throw on it, which is the
      // schema-drift bug class this repository has already shipped twice.
      expect(() =>
        previewTemplateResponseSchema.parse({
          en: { subject: 'S', html: '<html></html>', text: 'S' },
          fr: { subject: 'A', html: '<html></html>', text: 'A' },
        }),
      ).not.toThrow();
      expect(() =>
        previewTemplateResponseSchema.parse({
          fr: { subject: 'Sujet', html: '<html></html>', text: 'Sujet' },
          en: { subject: 'S', html: '<html></html>', text: 'S' },
        }),
      ).not.toThrow();
      expect(() =>
        previewTemplateResponseSchema.parse({ en: { subject: 'S', html: 'x', text: 'S' } }),
      ).not.toThrow();
    });

    it('still rejects a malformed locale entry', () => {
      // Widening the KEY set must not widen the VALUE shape: an entry missing
      // `text`, or one that is not an object at all, is still a parse failure.
      expect(() =>
        previewTemplateResponseSchema.parse({ en: { subject: 'S', html: 'x' } }),
      ).toThrow();
      expect(() => previewTemplateResponseSchema.parse({ en: 'S' })).toThrow();
      expect(() => previewTemplateResponseSchema.parse('nope')).toThrow();
    });

    it('parses a send-test response (honest enqueue outcome)', () => {
      expect(() =>
        sendTestResponseSchema.parse({
          status: 'queued',
          recipient: 'me@store.test',
          logId: 'log-9',
        }),
      ).not.toThrow();
    });

    it('rejects a send-test status outside the enqueue-outcome enum', () => {
      expect(() =>
        sendTestResponseSchema.parse({ status: 'delivered', recipient: 'x', logId: 'l' }),
      ).toThrow();
    });
  });

  describe('in-app notification text resolvers', () => {
    const base = {
      id: 'n-1',
      userId: 'u-1',
      type: 'NEW_ORDER',
      title: { default: 'Commande', fr: 'Nouvelle commande', en: 'New order' },
      body: { default: 'Corps', fr: 'Contenu', en: 'Body' },
      isRead: false,
      createdAt: '2026-06-18T10:00:00.000Z',
    };

    it('parses an admin notification', () => {
      expect(() => adminNotificationSchema.parse(base)).not.toThrow();
    });

    it('resolves the requested locale when the notification carries it', () => {
      const n = adminNotificationSchema.parse(base);
      expect(notificationTitleText(n, 'fr')).toBe('Nouvelle commande');
      expect(notificationTitleText(n, 'en')).toBe('New order');
      expect(notificationBodyText(n, 'fr')).toBe('Contenu');
      expect(notificationBodyText(n, 'en')).toBe('Body');
    });

    it('falls back to `default` for a locale the notification does not carry', () => {
      // The locale has to sit OUTSIDE the fixture or every assertion satisfies
      // the first rung and the `default` branch goes uncovered, which is what
      // happened when this fixture moved off the previous client's locale pair.
      const n = adminNotificationSchema.parse(base);
      expect(notificationTitleText(n, 'de')).toBe('Commande');
      expect(notificationBodyText(n, 'de')).toBe('Corps');
    });

    it('returns a sensible default when the title is absent', () => {
      const n = adminNotificationSchema.parse({ ...base, title: undefined });
      expect(notificationTitleText(n)).toBe('Notification');
    });
  });
});
