import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { IS_PUBLIC_KEY } from '@common/decorators';
import { BRAND_TOKEN_KEYS, generatePalette } from '@common/brand';
import { StoreConfigComposer } from './store-config.composer';
import { StoreConfigController } from './store-config.controller';

describe('StoreConfigController', () => {
  const composer = { getStoreConfig: jest.fn() };
  let controller: StoreConfigController;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      controllers: [StoreConfigController],
      providers: [{ provide: StoreConfigComposer, useValue: composer }],
    }).compile();
    controller = module.get(StoreConfigController);
  });

  it('returns the composed config unwrapped for the response interceptor', async () => {
    const config = { identity: { brandName: 'store' } };
    composer.getStoreConfig.mockResolvedValue(config);
    await expect(controller.getConfig()).resolves.toBe(config);
  });

  it('passes the generated palette through to the response', async () => {
    // The route must not project the composed payload: the storefront renders
    // its token block straight from what this returns (plan E2.2).
    const config = generatePalette({ primary: '#1f4e79', secondary: null, accent: null });
    composer.getStoreConfig.mockResolvedValue({ brand: { generatedPalette: config } });
    const body = (await controller.getConfig()) as unknown as {
      brand: { generatedPalette: typeof config };
    };
    expect(Object.keys(body.brand.generatedPalette.tokens).sort()).toEqual(
      [...BRAND_TOKEN_KEYS].sort(),
    );
  });

  it('is public and browser-cacheable for the Redis window, per §3.15-A', () => {
    const handler = StoreConfigController.prototype.getConfig;
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBe(true);
    // @Header() stores its pairs under Nest's `__headers__` key.
    const headers = Reflect.getMetadata('__headers__', handler) as Array<{
      name: string;
      value: string;
    }>;
    expect(headers).toEqual(
      expect.arrayContaining([
        { name: 'Cache-Control', value: 'public, max-age=60' },
        { name: 'Vary', value: 'X-Locale, Accept-Language, X-Resolve-Locale' },
      ]),
    );
  });
});
