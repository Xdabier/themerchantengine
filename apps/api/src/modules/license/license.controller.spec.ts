import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { PERMISSIONS_KEY } from '@common/decorators';
import { LicenseController } from './license.controller';
import { LicenseService } from './license.service';

describe('LicenseController', () => {
  const service = { current: jest.fn(), install: jest.fn() };
  let controller: LicenseController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [LicenseController],
      providers: [{ provide: LicenseService, useValue: service }],
    }).compile();
    controller = module.get(LicenseController);
  });

  it('returns the boot verdict, and re-verifies on ?fresh=1', async () => {
    service.current.mockResolvedValue({ status: 'valid' });
    await expect(controller.get()).resolves.toEqual({ status: 'valid' });
    expect(service.current).toHaveBeenLastCalledWith(false);
    await controller.get('1');
    expect(service.current).toHaveBeenLastCalledWith(true);
  });

  it('is gated on license:view', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, LicenseController.prototype.get)).toEqual([
      'license:view',
    ]);
  });

  it('is gated on license:manage for the install route', () => {
    // A read permission on a write route would let any admin with a settings
    // view replace the file the engine trusts.
    expect(Reflect.getMetadata(PERMISSIONS_KEY, LicenseController.prototype.install)).toEqual([
      'license:manage',
    ]);
  });

  it('hands the uploaded bytes to the service and nothing else', async () => {
    service.install.mockResolvedValue({ status: 'valid' });

    await controller.install({
      buffer: Buffer.from('{"claims":{}}', 'utf8'),
      size: 13,
      originalname: '../../etc/passwd',
      path: '/tmp/somewhere',
    } as never);

    // Not the name, not the path: only the content. The destination is the
    // engine's configured one and the caller has no say in it.
    expect(service.install).toHaveBeenCalledWith('{"claims":{}}');
  });

  it('refuses a request with no file attached', async () => {
    await expect(controller.install(undefined)).rejects.toMatchObject({
      response: { error: { code: 'LICENSE_FILE_MISSING' } },
    });
    expect(service.install).not.toHaveBeenCalled();
  });

  it('refuses an empty file rather than writing one', async () => {
    await expect(
      controller.install({ buffer: Buffer.alloc(0), size: 0 } as never),
    ).rejects.toMatchObject({
      response: { error: { code: 'LICENSE_FILE_MISSING' } },
    });
    expect(service.install).not.toHaveBeenCalled();
  });
});
