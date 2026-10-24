import { FormControl } from '@angular/forms';
import { translatableRequired } from './translatable-required.validator';

describe('translatableRequired', () => {
  const run = (value: unknown) => translatableRequired(new FormControl(value));

  it('passes when the default key has text', () => {
    expect(run({ default: 'Shoes' })).toBeNull();
  });

  it('fails on a null value', () => {
    expect(run(null)).toEqual({ translatableRequired: true });
  });

  it('fails when the default key is empty or whitespace', () => {
    expect(run({ default: '' })).toEqual({ translatableRequired: true });
    expect(run({ default: '   ' })).toEqual({ translatableRequired: true });
  });

  it('fails when only a non-default locale is filled', () => {
    expect(run({ default: '', fr: 'Chaussures' })).toEqual({ translatableRequired: true });
  });

  it('fails when the default key is not a string', () => {
    expect(run({ default: 4 })).toEqual({ translatableRequired: true });
  });
});
