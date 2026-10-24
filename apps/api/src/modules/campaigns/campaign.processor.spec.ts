import { CampaignProcessor } from './campaign.processor';

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    data: { campaignId: 'c1' },
    opts: { attempts: 3 },
    attemptsMade: 0,
    ...overrides,
  } as never;
}

describe('CampaignProcessor', () => {
  let campaigns: { processBatch: jest.Mock; markFailed: jest.Mock };
  let processor: CampaignProcessor;

  beforeEach(() => {
    campaigns = {
      processBatch: jest.fn().mockResolvedValue({ done: true, sent: 1 }),
      markFailed: jest.fn(),
    };
    processor = new CampaignProcessor(campaigns as never);
  });

  it('delegates to CampaignService.processBatch', async () => {
    await processor.process(makeJob());
    expect(campaigns.processBatch).toHaveBeenCalledWith('c1');
    expect(campaigns.markFailed).not.toHaveBeenCalled();
  });

  it('rethrows without marking failed on a non-final attempt', async () => {
    campaigns.processBatch.mockRejectedValue(new Error('boom'));
    await expect(processor.process(makeJob({ attemptsMade: 0 }))).rejects.toThrow('boom');
    expect(campaigns.markFailed).not.toHaveBeenCalled();
  });

  it('marks the campaign FAILED on the final attempt then rethrows', async () => {
    campaigns.processBatch.mockRejectedValue(new Error('boom'));
    await expect(processor.process(makeJob({ attemptsMade: 2 }))).rejects.toThrow('boom');
    expect(campaigns.markFailed).toHaveBeenCalledWith('c1', 'boom');
  });
});
