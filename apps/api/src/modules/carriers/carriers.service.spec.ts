import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { CarriersService } from './carriers.service';

function makeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'car-1',
    code: 'dhl_express',
    name: { default: 'DHL Express', en: 'DHL Express' },
    provider: 'dhl',
    services: ['express', 'economy'],
    zones: ['QA', 'AE'],
    isActive: false,
    sortOrder: 0,
    config: { apiKey: 'secret_xxxx', accountNumber: '1234' },
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

function makePrismaMock() {
  return {
    carrier: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
  };
}

describe('CarriersService', () => {
  let service: CarriersService;
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(async () => {
    prisma = makePrismaMock();
    const module: TestingModule = await Test.createTestingModule({
      providers: [CarriersService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(CarriersService);
  });

  it('list masks apiKey + accountNumber', async () => {
    prisma.carrier.findMany.mockResolvedValue([makeRow()]);
    prisma.carrier.count.mockResolvedValue(1);
    const res = await service.list({});
    expect(res.data[0].config['apiKey']).toBe('***');
    expect(res.data[0].config['accountNumber']).toBe('***');
  });

  it('create rejects duplicate code with 409', async () => {
    prisma.carrier.findUnique.mockResolvedValue({ id: 'x' });
    await expect(
      service.create({ code: 'dhl_express', name: { default: 'X' }, provider: 'dhl' } as never),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('update 404s when missing', async () => {
    prisma.carrier.findFirst.mockResolvedValue(null);
    await expect(service.update('missing', { isActive: true })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('update merges config — masked value keeps the stored secret', async () => {
    prisma.carrier.findFirst.mockResolvedValue(makeRow({ config: { apiKey: 'real', flag: true } }));
    prisma.carrier.update.mockImplementation(({ data }: { data: unknown }) =>
      Promise.resolve(makeRow({ config: (data as { config: unknown }).config })),
    );
    await service.update('car-1', { config: { apiKey: '***', flag: false } });
    const write = prisma.carrier.update.mock.calls[0][0];
    expect(write.data.config['apiKey']).toBe('real');
    expect(write.data.config['flag']).toBe(false);
  });

  it('remove soft-deletes + clears active flag', async () => {
    prisma.carrier.findFirst.mockResolvedValue({ id: 'car-1' });
    prisma.carrier.update.mockResolvedValue(makeRow());
    await service.remove('car-1');
    const write = prisma.carrier.update.mock.calls[0][0];
    expect(write.data.isActive).toBe(false);
    expect(write.data.deletedAt).toBeInstanceOf(Date);
  });
});
