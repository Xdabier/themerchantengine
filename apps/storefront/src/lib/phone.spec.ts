import { describe, expect, it } from 'vitest';

import { PHONE_RE } from './phone';

/**
 * The defect these pin: the address form refused `+218 21 000 000` with "Enter
 * a valid phone number" while accepting `+21671000000`, so the site rejected
 * the format it prints in its own footer and seeds into its own fixtures.
 *
 * The digit count is the rule; the grouping is the customer's business.
 */
describe('PHONE_RE', () => {
  it.each([
    ['+218 21 000 000', 'the spaced international form the seed and footer use'],
    ['+21671000000', 'the same number with no grouping'],
    ['+216-71-000-000', 'hyphen grouping'],
    ['(216) 71 000 000', 'parenthesised country code'],
    ['71.000.000', 'dot grouping, no country code'],
    ['216000', 'the six-digit floor'],
    ['+123456789012345', 'the fifteen-digit ceiling'],
  ])('accepts %s (%s)', (value) => {
    expect(PHONE_RE.test(value)).toBe(true);
  });

  it.each([
    ['', 'empty'],
    ['   ', 'separators only, no digits'],
    ['12345', 'five digits, under the floor'],
    ['+1234567890123456', 'sixteen digits, over the ceiling'],
    ['+216 71 000 00a', 'a letter'],
    ['+216 71 000 000 ext 4', 'an extension in words'],
    ['++21671000000', 'two plus signs'],
    ['216+71000000', 'a plus that is not leading'],
  ])('rejects %s (%s)', (value) => {
    expect(PHONE_RE.test(value)).toBe(false);
  });

  it('counts digits rather than characters, so grouping cannot buy length', () => {
    // Nine separators and five digits is still five digits.
    expect(PHONE_RE.test('1 2 3 4 5')).toBe(false);
    expect(PHONE_RE.test('1 2 3 4 5 6')).toBe(true);
  });
});
