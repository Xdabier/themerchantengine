import { ConfigService } from '@nestjs/config';
import { Job, Queue } from 'bullmq';
import { LlmsTxtProcessor } from './llms-txt.processor';
import { GeoService } from '../geo.service';

describe('LlmsTxtProcessor', () => {
  let processor: LlmsTxtProcessor;
  let mockGeoService: jest.Mocked<GeoService>;
  let mockConfig: jest.Mocked<ConfigService>;
  let mockQueue: jest.Mocked<Queue>;

  beforeEach(() => {
    mockGeoService = {
      regenerateLlmsTxt: jest.fn().mockResolvedValue(undefined),
      regenerateLlmsFullTxt: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<GeoService>;

    mockConfig = {
      get: jest.fn().mockImplementation((key: string, fallback?: string) => {
        if (key === 'STOREFRONT_PUBLIC_BASE_URL') return 'https://atlas.example';
        return fallback;
      }),
    } as unknown as jest.Mocked<ConfigService>;

    mockQueue = {
      add: jest.fn().mockResolvedValue({ id: 'cron-1' }),
    } as unknown as jest.Mocked<Queue>;

    processor = new LlmsTxtProcessor(mockGeoService, mockConfig, mockQueue);
  });

  describe('onModuleInit()', () => {
    it('registers the recurring 6-hour cron job at boot', async () => {
      await processor.onModuleInit();
      expect(mockQueue.add).toHaveBeenCalledTimes(1);
      const [jobName, , opts] = mockQueue.add.mock.calls[0];
      expect(jobName).toBe('generate');
      expect(opts).toMatchObject({
        repeat: { pattern: '0 */6 * * *' },
        jobId: 'llms-txt-cron',
      });
    });
  });

  describe('process()', () => {
    const fakeJob = { id: 'job-1' } as unknown as Job;

    it('calls GeoService.regenerateLlmsTxt with STOREFRONT_PUBLIC_BASE_URL', async () => {
      await processor.process(fakeJob);
      expect(mockGeoService.regenerateLlmsTxt).toHaveBeenCalledWith('https://atlas.example');
    });

    it('calls GeoService.regenerateLlmsFullTxt with the same site URL in the same job', async () => {
      await processor.process(fakeJob);
      expect(mockGeoService.regenerateLlmsFullTxt).toHaveBeenCalledWith('https://atlas.example');
    });

    it('falls back to legacy SITE_URL when STOREFRONT_PUBLIC_BASE_URL is unset', async () => {
      (mockConfig.get as jest.Mock).mockImplementation((key: string, fallback?: string) => {
        if (key === 'SITE_URL') return 'https://legacy.test';
        return fallback;
      });
      await processor.process(fakeJob);
      expect(mockGeoService.regenerateLlmsTxt).toHaveBeenCalledWith('https://legacy.test');
      expect(mockGeoService.regenerateLlmsFullTxt).toHaveBeenCalledWith('https://legacy.test');
    });

    it('rethrows on regeneration failure (BullMQ retries via defaultJobOptions)', async () => {
      mockGeoService.regenerateLlmsTxt.mockRejectedValueOnce(new Error('redis offline'));
      await expect(processor.process(fakeJob)).rejects.toThrow('redis offline');
    });

    it('rethrows when llms-full.txt regen fails (coherence guarantee)', async () => {
      mockGeoService.regenerateLlmsFullTxt.mockRejectedValueOnce(new Error('full failed'));
      await expect(processor.process(fakeJob)).rejects.toThrow('full failed');
    });
  });
});
