import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { ProcessedWebhookService } from './processed-webhook.service';

function makePrisma() {
  return {
    processedWebhook: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
    },
  };
}

async function makeService(prisma: ReturnType<typeof makePrisma>) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [ProcessedWebhookService, { provide: PrismaService, useValue: prisma }],
  }).compile();
  return module.get(ProcessedWebhookService);
}

describe('ProcessedWebhookService', () => {
  describe('recordInboundEvent', () => {
    it('upserts a new row on first encounter and returns alreadyProcessed=false', async () => {
      const prisma = makePrisma();
      const processedAt = new Date('2026-05-15T00:00:00Z');
      prisma.processedWebhook.findUnique.mockResolvedValue(null);
      prisma.processedWebhook.upsert.mockResolvedValue({ processedAt });
      const svc = await makeService(prisma);

      const result = await svc.recordInboundEvent('stripe', 'evt_test_1', { foo: 'bar' });

      expect(result).toEqual({ alreadyProcessed: false, processedAt });
      expect(prisma.processedWebhook.upsert).toHaveBeenCalledWith({
        where: {
          provider_externalEventId: { provider: 'stripe', externalEventId: 'evt_test_1' },
        },
        update: {},
        create: { provider: 'stripe', externalEventId: 'evt_test_1' },
        select: { processedAt: true },
      });
    });

    it('returns alreadyProcessed=true with cached processedAt when the (provider, eventId) row already exists', async () => {
      const prisma = makePrisma();
      const cachedAt = new Date('2026-05-15T01:00:00Z');
      prisma.processedWebhook.findUnique.mockResolvedValue({ processedAt: cachedAt });
      const svc = await makeService(prisma);

      const result = await svc.recordInboundEvent('stripe', 'evt_test_replay', { foo: 'bar' });

      expect(result).toEqual({ alreadyProcessed: true, processedAt: cachedAt });
      expect(prisma.processedWebhook.upsert).not.toHaveBeenCalled();
      expect(prisma.processedWebhook.findUnique).toHaveBeenCalledWith({
        where: {
          provider_externalEventId: { provider: 'stripe', externalEventId: 'evt_test_replay' },
        },
        select: { processedAt: true },
      });
    });

    it('rethrows Prisma errors verbatim (no swallow)', async () => {
      const prisma = makePrisma();
      prisma.processedWebhook.findUnique.mockRejectedValue(new Error('Database connection lost'));
      const svc = await makeService(prisma);

      await expect(svc.recordInboundEvent('stripe', 'evt_db_down', {})).rejects.toThrow(
        'Database connection lost',
      );
    });

    it('rethrows non-Prisma errors verbatim', async () => {
      const prisma = makePrisma();
      prisma.processedWebhook.findUnique.mockResolvedValue(null);
      prisma.processedWebhook.upsert.mockRejectedValue(new Error('boom'));
      const svc = await makeService(prisma);

      await expect(svc.recordInboundEvent('stripe', 'evt_boom', {})).rejects.toThrow('boom');
    });

    it('does not leak the payload contents into log lines (constitution §3.7)', async () => {
      const prisma = makePrisma();
      prisma.processedWebhook.findUnique.mockResolvedValue(null);
      prisma.processedWebhook.upsert.mockResolvedValue({ processedAt: new Date() });
      const svc = await makeService(prisma);
      const logSpy = jest.spyOn(svc['logger'], 'log').mockImplementation();

      const sensitivePayload = { customerSecret: 'sk_test_DO_NOT_LEAK', amount: 12345 };
      await svc.recordInboundEvent('stripe', 'evt_safe', sensitivePayload);

      expect(logSpy).toHaveBeenCalledTimes(1);
      const message = logSpy.mock.calls[0]?.[0] as string;
      expect(message).not.toContain('sk_test_DO_NOT_LEAK');
      expect(message).not.toContain('12345');
      expect(message).toContain('eventId="evt_safe"');
    });
  });

  describe('isProcessed', () => {
    it('reports a recorded (provider, eventId) pair without writing', async () => {
      const prisma = makePrisma();
      prisma.processedWebhook.findUnique.mockResolvedValue({ processedAt: new Date() });
      const svc = await makeService(prisma);

      await expect(svc.isProcessed('payments:cod', 'evt-1')).resolves.toBe(true);
      expect(prisma.processedWebhook.findUnique).toHaveBeenCalledWith({
        where: { provider_externalEventId: { provider: 'payments:cod', externalEventId: 'evt-1' } },
        select: { processedAt: true },
      });
      expect(prisma.processedWebhook.upsert).not.toHaveBeenCalled();
    });

    it('reports an unseen pair as not processed', async () => {
      const prisma = makePrisma();
      prisma.processedWebhook.findUnique.mockResolvedValue(null);
      const svc = await makeService(prisma);

      await expect(svc.isProcessed('payments:cod', 'evt-2')).resolves.toBe(false);
    });
  });
});
