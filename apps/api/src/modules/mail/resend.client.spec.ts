import { ResendClient, RESEND_BATCH_MAX, type ResendBatchItem } from './resend.client';

function makeConfig(values: Record<string, string>) {
  return { get: jest.fn((k: string, d?: string) => values[k] ?? d) } as never;
}

function item(to: string): ResendBatchItem {
  return { from: 'Shop <noreply@x>', to, subject: 's', html: '<p>h</p>', text: 't' };
}

describe('ResendClient.sendBatch', () => {
  it('dry-run returns one synthetic id per item without a network call', async () => {
    const client = new ResendClient(makeConfig({ MAIL_TRANSPORT: 'console' }));
    const res = await client.sendBatch([item('a@x'), item('b@x')]);
    expect(res.dryRun).toBe(true);
    expect(res.ids).toHaveLength(2);
    expect(res.ids[0]).toMatch(/^console_/);
  });

  it('returns an empty result for an empty batch', async () => {
    const client = new ResendClient(makeConfig({ MAIL_TRANSPORT: 'console' }));
    await expect(client.sendBatch([])).resolves.toEqual({ ids: [], dryRun: true });
  });

  it('throws when a batch exceeds the Resend cap', async () => {
    const client = new ResendClient(makeConfig({ MAIL_TRANSPORT: 'console' }));
    const tooMany = Array.from({ length: RESEND_BATCH_MAX + 1 }, (_, i) => item(`u${i}@x`));
    await expect(client.sendBatch(tooMany)).rejects.toThrow(/max 100/);
  });

  it('live mode unwraps provider ids index-aligned to items', async () => {
    const client = new ResendClient(
      makeConfig({ MAIL_TRANSPORT: 'resend', RESEND_API_KEY: 're_x' }),
    );
    const send = jest
      .fn()
      .mockResolvedValue({ data: { data: [{ id: 'm1' }, { id: 'm2' }] }, error: null });
    (client as unknown as { client: { batch: { send: jest.Mock } } }).client.batch = { send };
    const res = await client.sendBatch([item('a@x'), item('b@x')], { idempotencyKey: 'k1' });
    expect(res).toEqual({ ids: ['m1', 'm2'], dryRun: false });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][1]).toEqual({ idempotencyKey: 'k1' });
  });

  it('live mode throws on a provider error', async () => {
    const client = new ResendClient(
      makeConfig({ MAIL_TRANSPORT: 'resend', RESEND_API_KEY: 're_x' }),
    );
    const send = jest
      .fn()
      .mockResolvedValue({ data: null, error: { name: 'rate_limit', message: 'slow down' } });
    (client as unknown as { client: { batch: { send: jest.Mock } } }).client.batch = { send };
    await expect(client.sendBatch([item('a@x')])).rejects.toThrow(/resend batch: rate_limit/);
  });
});
