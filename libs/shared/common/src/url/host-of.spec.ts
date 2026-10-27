import { hostOf } from './host-of';

describe('hostOf', () => {
  it('reads the lowercase hostname off an origin', () => {
    expect(hostOf('https://Admin.Shop.example:8443/')).toBe('admin.shop.example');
    expect(hostOf('http://localhost:53300')).toBe('localhost');
  });

  it('gives null for an empty or unparseable origin', () => {
    expect(hostOf('')).toBeNull();
    expect(hostOf('not a url')).toBeNull();
  });
});
