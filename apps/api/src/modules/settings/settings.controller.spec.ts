import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { PERMISSIONS_KEY } from '@common/decorators';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

/**
 * Plan E3, gate B. The permission on each settings route was only ever proven
 * indirectly, by the 403 legs of `test/settings.e2e-spec.ts`. That leaves the
 * read and the write indistinguishable to a reader of this module: an editor
 * who can view settings and a manager who can change them differ by one
 * decorator, and a decorator dropped in a refactor fails no unit test.
 *
 * The metadata assertions below name the read and the write separately on
 * purpose.
 */
describe('SettingsController', () => {
  const service = {
    getAllGrouped: jest.fn(),
    updateMany: jest.fn(),
    getLocales: jest.fn(),
    updateLocales: jest.fn(),
  };
  let controller: SettingsController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [SettingsController],
      providers: [{ provide: SettingsService, useValue: service }],
    }).compile();
    controller = module.get(SettingsController);
  });

  it('reads every group through one call', async () => {
    service.getAllGrouped.mockResolvedValue({ general: {} });

    await expect(controller.getAll()).resolves.toEqual({ general: {} });
  });

  it('writes the patch, then returns the settings it just wrote', async () => {
    service.getAllGrouped.mockResolvedValue({ general: { contactEmail: 'owner@example.com' } });

    const result = await controller.update({ contactEmail: 'owner@example.com' });

    expect(service.updateMany).toHaveBeenCalledWith({ contactEmail: 'owner@example.com' });
    expect(result).toEqual({ general: { contactEmail: 'owner@example.com' } });
  });

  it('passes both locale fields through as a pair', async () => {
    service.getLocales.mockResolvedValue({ supportedLocales: ['fr', 'en'], defaultLocale: 'fr' });

    await controller.updateLocales({ supportedLocales: ['fr', 'en'], defaultLocale: 'fr' });

    expect(service.updateLocales).toHaveBeenCalledWith(['fr', 'en'], 'fr', undefined);
  });

  it('passes rtlLocales through when given', async () => {
    service.getLocales.mockResolvedValue({ supportedLocales: ['fr', 'ar'], defaultLocale: 'fr' });

    await controller.updateLocales({
      supportedLocales: ['fr', 'ar'],
      defaultLocale: 'fr',
      rtlLocales: ['ar'],
    });

    expect(service.updateLocales).toHaveBeenCalledWith(['fr', 'ar'], 'fr', ['ar']);
  });

  it('gates both reads on settings:view', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, SettingsController.prototype.getAll)).toEqual([
      'settings:view',
    ]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, SettingsController.prototype.getLocales)).toEqual([
      'settings:view',
    ]);
  });

  it('gates both writes on settings:manage', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, SettingsController.prototype.update)).toEqual([
      'settings:manage',
    ]);
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, SettingsController.prototype.updateLocales),
    ).toEqual(['settings:manage']);
  });
});
