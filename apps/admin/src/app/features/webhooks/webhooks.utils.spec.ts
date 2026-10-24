import { deliveryStatusBadge } from './webhooks.utils';

describe('deliveryStatusBadge', () => {
  it('returns success when succeededAt is present', () => {
    expect(
      deliveryStatusBadge({
        succeededAt: '2026-04-20T10:00:00.000Z',
        failedAt: null,
        nextRetryAt: null,
      }),
    ).toEqual({ tone: 'success', label: 'Succeeded' });
  });

  it('returns retrying when failedAt and nextRetryAt are both present', () => {
    expect(
      deliveryStatusBadge({
        succeededAt: null,
        failedAt: '2026-04-20T10:00:00.000Z',
        nextRetryAt: '2026-04-20T10:01:00.000Z',
      }),
    ).toEqual({ tone: 'warning', label: 'Retrying' });
  });

  it('returns failed when failedAt is present and nextRetryAt is null', () => {
    expect(
      deliveryStatusBadge({
        succeededAt: null,
        failedAt: '2026-04-20T10:00:00.000Z',
        nextRetryAt: null,
      }),
    ).toEqual({ tone: 'error', label: 'Failed' });
  });

  it('returns pending when neither succeededAt nor failedAt is present', () => {
    expect(
      deliveryStatusBadge({
        succeededAt: null,
        failedAt: null,
        nextRetryAt: null,
      }),
    ).toEqual({ tone: 'neutral', label: 'Pending' });
  });

  it('treats undefined as null for the absence checks', () => {
    expect(
      deliveryStatusBadge({
        succeededAt: undefined,
        failedAt: undefined,
        nextRetryAt: undefined,
      }),
    ).toEqual({ tone: 'neutral', label: 'Pending' });
  });
});
