import {
  activitySentence,
  auditActionTitle,
  auditEntityLabel,
  auditVerbLabel,
} from './audit-labels';

describe('audit-labels', () => {
  describe('auditEntityLabel', () => {
    it('uses the curated label for backend snake_case entity types', () => {
      expect(auditEntityLabel('gift_card')).toBe('gift card');
      expect(auditEntityLabel('storefront_config')).toBe('storefront section');
      expect(auditEntityLabel('cms')).toBe('CMS page');
    });

    it('humanizes unknown entity types in lower case', () => {
      expect(auditEntityLabel('loyalty_tier')).toBe('loyalty tier');
    });

    it('falls back to a neutral noun for nullish types', () => {
      expect(auditEntityLabel(null)).toBe('record');
      expect(auditEntityLabel('')).toBe('record');
    });
  });

  describe('auditVerbLabel', () => {
    it('normalizes both the imperative and past-tense backend forms', () => {
      expect(auditVerbLabel('create')).toBe('created');
      expect(auditVerbLabel('created')).toBe('created');
      expect(auditVerbLabel('update')).toBe('updated');
      expect(auditVerbLabel('updated')).toBe('updated');
      expect(auditVerbLabel('delete')).toBe('deleted');
      expect(auditVerbLabel('deleted')).toBe('deleted');
    });

    it('maps the generic mutate fallback to a readable verb', () => {
      expect(auditVerbLabel('mutate')).toBe('changed');
    });

    it('humanizes unknown verbs in lower case', () => {
      expect(auditVerbLabel('archive')).toBe('archive');
      expect(auditVerbLabel(null)).toBe('changed');
    });
  });

  describe('auditActionTitle', () => {
    it('renders the column form from the same vocabulary as the sentence form', () => {
      expect(auditActionTitle('webhook.delete')).toBe('Webhook Deleted');
      expect(auditActionTitle('gift_card.update')).toBe('Gift Card Updated');
    });

    it('keeps acronyms upper case', () => {
      expect(auditActionTitle('cms.create')).toBe('CMS Page Created');
    });

    it('humanizes an action that does not parse', () => {
      expect(auditActionTitle('login')).toBe('Login');
      expect(auditActionTitle(null)).toBe('—');
    });
  });

  describe('activitySentence', () => {
    it('composes actor + verb + entity for a dotted action key', () => {
      expect(
        activitySentence({ actor: 'Super Admin', action: 'webhook.delete', entityType: 'webhook' }),
      ).toBe('Super Admin deleted a webhook');
    });

    it('uses the curated entity label and "an" before a vowel', () => {
      expect(
        activitySentence({
          actor: 'Sara Ali',
          action: 'gift_card.update',
          entityType: 'gift_card',
        }),
      ).toBe('Sara Ali updated a gift card');
      expect(
        activitySentence({ actor: 'Sara Ali', action: 'order.create', entityType: 'order' }),
      ).toBe('Sara Ali created an order');
    });

    it('accepts the past-tense actions some services write by hand', () => {
      expect(
        activitySentence({ actor: 'Super Admin', action: 'review.updated', entityType: 'review' }),
      ).toBe('Super Admin updated a review');
    });

    it('names a missing actor System', () => {
      expect(activitySentence({ actor: null, action: 'order.create', entityType: 'order' })).toBe(
        'System created an order',
      );
    });

    it('falls back to the entityType when the action carries no entity segment', () => {
      expect(
        activitySentence({ actor: 'Super Admin', action: '.delete', entityType: 'gift_card' }),
      ).toBe('Super Admin deleted a gift card');
    });

    it('falls back to a dotted layout when the action does not parse', () => {
      expect(
        activitySentence({ actor: 'Super Admin', action: 'login', entityType: 'session' }),
      ).toBe('Super Admin · Login');
      expect(activitySentence({ actor: null, action: null, entityType: null })).toBe('System · —');
    });

    it('never leaks the raw action key or a snake_case entity type', () => {
      const out = activitySentence({
        actor: 'Super Admin',
        action: 'storefront_config.update',
        entityType: 'storefront_config',
      });
      expect(out).not.toContain('storefront_config');
      expect(out).not.toContain('.update');
    });
  });
});
