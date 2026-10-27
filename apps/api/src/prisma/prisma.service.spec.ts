import { applySoftDeleteFilter, SOFT_DELETE_MODELS } from './prisma.service';

describe('applySoftDeleteFilter', () => {
  describe('models without deletedAt', () => {
    it('returns args unchanged for a model not in the soft-delete list', () => {
      const args = { where: { id: '1' } };
      expect(applySoftDeleteFilter('Order', args)).toBe(args);
    });

    it('returns args unchanged for unknown model names', () => {
      const args = { where: { slug: 'test' } };
      expect(applySoftDeleteFilter('SomeUnknownModel', args)).toBe(args);
    });
  });

  describe('models with deletedAt', () => {
    const softModels: string[] = [...SOFT_DELETE_MODELS];

    it.each(softModels)('%s: adds deletedAt: null when not present in where', (model) => {
      const args = { where: { id: 'abc' } };
      const result = applySoftDeleteFilter(model, args) as typeof args & {
        where: { deletedAt: unknown };
      };
      expect(result.where.deletedAt).toBeNull();
      expect(result.where).toMatchObject({ id: 'abc' });
    });

    it('adds deletedAt: null when where is empty', () => {
      const args = { where: {} };
      const result = applySoftDeleteFilter('User', args) as {
        where: { deletedAt: unknown };
      };
      expect(result.where.deletedAt).toBeNull();
    });

    it('adds deletedAt: null when args has no where key', () => {
      const args = {};
      const result = applySoftDeleteFilter('User', args) as {
        where: { deletedAt: unknown };
      };
      expect(result.where.deletedAt).toBeNull();
    });

    it('does NOT override when caller passes deletedAt: null explicitly', () => {
      const args = { where: { deletedAt: null } };
      const result = applySoftDeleteFilter('User', args);
      // where already has deletedAt, so we bypass and return original
      expect(result).toBe(args);
    });

    it('does NOT override when caller passes deletedAt: { not: null } for admin recovery', () => {
      const args = { where: { deletedAt: { not: null } } };
      const result = applySoftDeleteFilter('User', args);
      expect(result).toBe(args);
    });

    it('does not mutate the original args object', () => {
      const args = { where: { id: '1' } };
      const originalWhere = args.where;
      applySoftDeleteFilter('Product', args);
      expect(args.where).toBe(originalWhere);
    });
  });

  describe('SOFT_DELETE_MODELS constant', () => {
    it('contains the expected models', () => {
      expect(SOFT_DELETE_MODELS).toContain('User');
      expect(SOFT_DELETE_MODELS).toContain('Product');
      expect(SOFT_DELETE_MODELS).toContain('ProductVariant');
      expect(SOFT_DELETE_MODELS).toContain('Category');
      expect(SOFT_DELETE_MODELS).toContain('Cart');
      expect(SOFT_DELETE_MODELS).toContain('Promotion');
      expect(SOFT_DELETE_MODELS).toContain('GiftCard');
      expect(SOFT_DELETE_MODELS).toContain('ShippingZone');
      expect(SOFT_DELETE_MODELS).toContain('ShippingMethod');
      expect(SOFT_DELETE_MODELS).toContain('TaxZone');
      expect(SOFT_DELETE_MODELS).toContain('StorefrontSection');
      expect(SOFT_DELETE_MODELS).toContain('CmsPage');
      expect(SOFT_DELETE_MODELS).toContain('Brand');
      // E2.15 — audit plan §1.11 WARN closure (Carrier + PaymentMethod
      // carry `deletedAt` in the schema but were missing from this list).
      expect(SOFT_DELETE_MODELS).toContain('Carrier');
      expect(SOFT_DELETE_MODELS).toContain('PaymentMethod');
    });

    it('filters Carrier queries by deletedAt: null when none specified', () => {
      const result = applySoftDeleteFilter('Carrier', { where: {} }) as {
        where: { deletedAt: null };
      };
      expect(result.where.deletedAt).toBeNull();
    });

    it('filters PaymentMethod queries by deletedAt: null when none specified', () => {
      const result = applySoftDeleteFilter('PaymentMethod', { where: {} }) as {
        where: { deletedAt: null };
      };
      expect(result.where.deletedAt).toBeNull();
    });
  });
});
