import { storeLocales } from '@common/locale';
import { SearchStorefrontController } from './search.controller';
import { SearchService } from './search.service';

describe('SearchStorefrontController locale from Accept-Language', () => {
  const search = {
    search: jest.fn(),
    suggest: jest.fn(),
  };
  const controller = new SearchStorefrontController(search as unknown as SearchService);

  beforeEach(() => jest.resetAllMocks());

  it.each([
    ['fr-FR', 'fr'],
    ['ar-TN,fr;q=0.8', 'ar'],
    ['en', 'en'],
    ['EN-us', 'en'],
    ['fr;q=0.9', 'fr'],
  ])('search strips the region of %s to %s', (header, expected) => {
    controller.searchProducts({} as never, { headers: { 'accept-language': header } });
    expect(search.search.mock.calls[0][1]).toBe(expected);
  });

  it('suggest strips the region', () => {
    controller.suggest({} as never, { headers: { 'accept-language': 'ar-QA' } });
    expect(search.suggest.mock.calls[0][1]).toBe('ar');
  });

  it('falls back to the store default without a header', () => {
    controller.suggest({} as never, { headers: {} });
    expect(search.suggest.mock.calls[0][1]).toBe(storeLocales.current().defaultLocale);
  });
});
