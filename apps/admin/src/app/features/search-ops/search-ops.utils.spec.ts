import { merchandisingTypeBadge } from './search-ops.utils';

describe('merchandisingTypeBadge', () => {
  it('returns success tone for BOOST', () => {
    expect(merchandisingTypeBadge('BOOST')).toEqual({ tone: 'success', label: 'Boost' });
  });

  it('returns warning tone for BURY', () => {
    expect(merchandisingTypeBadge('BURY')).toEqual({ tone: 'warning', label: 'Bury' });
  });

  it('returns info tone for PIN', () => {
    expect(merchandisingTypeBadge('PIN')).toEqual({ tone: 'info', label: 'Pin' });
  });

  it('returns neutral tone for REDIRECT', () => {
    expect(merchandisingTypeBadge('REDIRECT')).toEqual({ tone: 'neutral', label: 'Redirect' });
  });
});
