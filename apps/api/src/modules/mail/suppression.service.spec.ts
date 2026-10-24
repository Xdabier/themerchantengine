import { SuppressionService } from './suppression.service';

function makePrisma() {
  return {
    emailSuppression: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      updateMany: jest.fn(),
    },
  };
}

describe('SuppressionService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let service: SuppressionService;

  beforeEach(() => {
    prisma = makePrisma();
    service = new SuppressionService(prisma as never);
  });

  describe('isSuppressed', () => {
    it('returns true when a (non-soft-deleted) row exists', async () => {
      prisma.emailSuppression.findUnique.mockResolvedValue({ id: 's1' });
      await expect(service.isSuppressed('Foo@Bar.com ')).resolves.toBe(true);
      expect(prisma.emailSuppression.findUnique).toHaveBeenCalledWith({
        where: { email: 'foo@bar.com' },
        select: { id: true },
      });
    });

    it('returns false when no row exists', async () => {
      prisma.emailSuppression.findUnique.mockResolvedValue(null);
      await expect(service.isSuppressed('x@y.com')).resolves.toBe(false);
    });
  });

  describe('suppress', () => {
    it('upserts and revives a soft-deleted row (clears deletedAt)', async () => {
      prisma.emailSuppression.upsert.mockResolvedValue({});
      await service.suppress('A@B.com', 'bounce.hard', 'resend');
      expect(prisma.emailSuppression.upsert).toHaveBeenCalledWith({
        where: { email: 'a@b.com' },
        update: { deletedAt: null },
        create: { email: 'a@b.com', reason: 'bounce.hard', source: 'resend' },
      });
    });
  });

  describe('unsuppress', () => {
    it('soft-deletes rather than hard-deleting (NE7 Risk R8)', async () => {
      prisma.emailSuppression.updateMany.mockResolvedValue({ count: 1 });
      await service.unsuppress('A@B.com');
      const call = prisma.emailSuppression.updateMany.mock.calls[0][0];
      expect(call.where).toEqual({ email: 'a@b.com', deletedAt: null });
      expect(call.data.deletedAt).toBeInstanceOf(Date);
    });
  });
});
