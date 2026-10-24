import { previewCampaignResponseSchema, sendTestCampaignRequestSchema } from './campaigns';

describe('campaign preview + send-test schemas', () => {
  describe('previewCampaignResponseSchema', () => {
    it('parses whatever locale set the mail renderer returns', () => {
      // The renderer emits the store's own locales, and that pair has already
      // moved once. A fixed shape would have thrown on the move rather than
      // adapting to it.
      expect(() =>
        previewCampaignResponseSchema.parse({
          en: { subject: 'S', html: '<html></html>', text: 'S' },
          fr: { subject: 'A', html: '<html></html>', text: 'A' },
        }),
      ).not.toThrow();
      expect(() =>
        previewCampaignResponseSchema.parse({
          fr: { subject: 'Sujet', html: '<html></html>', text: 'Sujet' },
          en: { subject: 'S', html: '<html></html>', text: 'S' },
        }),
      ).not.toThrow();
      expect(() =>
        previewCampaignResponseSchema.parse({ en: { subject: 'S', html: 'x', text: 'S' } }),
      ).not.toThrow();
    });

    it('still rejects a malformed locale entry', () => {
      // Widening the KEY set must not widen the VALUE shape.
      expect(() =>
        previewCampaignResponseSchema.parse({ en: { subject: 'S', html: 'x' } }),
      ).toThrow();
      expect(() => previewCampaignResponseSchema.parse({ en: 'S' })).toThrow();
      expect(() => previewCampaignResponseSchema.parse('nope')).toThrow();
    });
  });

  describe('sendTestCampaignRequestSchema', () => {
    it('accepts any locale code, leaving the allowlist to the backend', () => {
      expect(() => sendTestCampaignRequestSchema.parse({ locale: 'fr' })).not.toThrow();
      expect(() => sendTestCampaignRequestSchema.parse({ locale: 'en' })).not.toThrow();
      expect(() => sendTestCampaignRequestSchema.parse({})).not.toThrow();
    });

    it('rejects a value that could not be a locale code at all', () => {
      expect(() => sendTestCampaignRequestSchema.parse({ locale: 'f' })).toThrow();
      expect(() => sendTestCampaignRequestSchema.parse({ locale: 7 })).toThrow();
    });
  });
});
