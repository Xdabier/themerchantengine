import { canonicalizeEmailForIdentity } from './email-identity.util';

describe('canonicalizeEmailForIdentity', () => {
  it('lowercases and trims every address', () => {
    expect(canonicalizeEmailForIdentity('  User@Example.COM ')).toBe('user@example.com');
  });

  it('strips dots in the gmail local part', () => {
    expect(canonicalizeEmailForIdentity('a.b.c@gmail.com')).toBe('abc@gmail.com');
    expect(canonicalizeEmailForIdentity('a.ll.e.n.he.e.s.eun.g.k@gmail.com')).toBe(
      'allenheeseungk@gmail.com',
    );
  });

  it('drops the +tag in the gmail local part', () => {
    expect(canonicalizeEmailForIdentity('abc+shopping@gmail.com')).toBe('abc@gmail.com');
    expect(canonicalizeEmailForIdentity('a.b+x.y@gmail.com')).toBe('ab@gmail.com');
  });

  it('folds googlemail.com to gmail.com', () => {
    expect(canonicalizeEmailForIdentity('a.b@googlemail.com')).toBe('ab@gmail.com');
  });

  it('collapses every gmail variant of one inbox to a single key', () => {
    const variants = ['abc@gmail.com', 'a.b.c@gmail.com', 'a.bc+promo@gmail.com', 'AB.C@GMAIL.COM'];
    const canonical = new Set(variants.map(canonicalizeEmailForIdentity));
    expect(canonical.size).toBe(1);
    expect([...canonical][0]).toBe('abc@gmail.com');
  });

  it('does NOT strip dots or tags for non-gmail domains', () => {
    expect(canonicalizeEmailForIdentity('a.b.c@outlook.com')).toBe('a.b.c@outlook.com');
    expect(canonicalizeEmailForIdentity('first.last+tag@company.org')).toBe(
      'first.last+tag@company.org',
    );
  });

  it('leaves a degenerate local part untouched rather than emitting @gmail.com', () => {
    expect(canonicalizeEmailForIdentity('+tag@gmail.com')).toBe('+tag@gmail.com');
  });
});
