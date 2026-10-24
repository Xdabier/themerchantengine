import { PHONE_RE, normalizePhone } from './phone';

/**
 * The endpoint half of the rule the storefront form enforces. Its mirror is
 * `apps/storefront/src/lib/phone.spec.ts`, and the two must agree on which
 * strings are numbers: a form that accepts what the API refuses moves the
 * refusal from an inline field error to a failed submit.
 */
describe('normalizePhone', () => {
  it.each([
    ['+216 71 000 000', '+21671000000'],
    ['+216-71-000-000', '+21671000000'],
    ['(216) 71 000 000', '21671000000'],
    ['71.000.000', '71000000'],
    ['+21671000000', '+21671000000'],
  ])('strips the grouping in %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it('passes a non-string through untouched, so @IsString() reports it', () => {
    expect(normalizePhone(undefined)).toBeUndefined();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(21671000000)).toBe(21671000000);
  });

  it('does not strip the leading plus', () => {
    expect(normalizePhone('+216 71 000 000')).toMatch(/^\+/);
  });
});

describe('PHONE_RE over normalised input', () => {
  const accepts = (raw: string) => PHONE_RE.test(normalizePhone(raw) as string);

  it.each([
    '+216 71 000 000',
    '+21671000000',
    '+216-71-000-000',
    '(216) 71 000 000',
    '216000',
    '+123456789012345',
  ])('accepts %s', (raw) => {
    expect(accepts(raw)).toBe(true);
  });

  it.each(['', '   ', '12345', '+1234567890123456', '+216 71 000 00a', '216+71000000'])(
    'rejects %s',
    (raw) => {
      expect(accepts(raw)).toBe(false);
    },
  );

  it('rejects the spaced form when normalisation is skipped', () => {
    // The strict pattern is only correct downstream of `normalizePhone`. If a
    // future DTO drops the @Transform, this is what it would be doing.
    expect(PHONE_RE.test('+216 71 000 000')).toBe(false);
  });
});
