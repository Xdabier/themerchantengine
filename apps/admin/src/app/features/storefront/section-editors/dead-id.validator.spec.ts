import { FormControl } from '@angular/forms';

import { deadIdValidator, unknownIdValidator } from './dead-id.validator';

describe('unknownIdValidator (categories: the whole live set is known)', () => {
  it('flags an id the tree does not contain', () => {
    // AD14: a configured id whose category was deleted must block save rather
    // than reach the storefront as a silent empty grid.
    const control = new FormControl(
      'gone',
      unknownIdValidator(() => new Set(['alive'])),
    );
    expect(control.errors).toEqual({ deadId: { id: 'gone' } });
    expect(control.valid).toBe(false);
  });

  it('accepts an id the tree contains', () => {
    const control = new FormControl(
      'alive',
      unknownIdValidator(() => new Set(['alive'])),
    );
    expect(control.errors).toBeNull();
  });

  it('stays quiet until the lookup settles, and if it fails', () => {
    // Null is "not looked up, or the lookup broke". Treating that as dead
    // would flash a false failure on load and let an outage block a save that
    // has nothing to do with the ids.
    const control = new FormControl(
      'anything',
      unknownIdValidator(() => null),
    );
    expect(control.errors).toBeNull();
  });

  it('leaves an empty control to the required validator', () => {
    // An empty row is incomplete, not dead. Two messages for one mistake.
    const control = new FormControl(
      '',
      unknownIdValidator(() => new Set(['alive'])),
    );
    expect(control.errors).toBeNull();
  });

  it('re-runs against a set that arrived after the control was built', () => {
    let live: ReadonlySet<string> | null = null;
    const control = new FormControl(
      'gone',
      unknownIdValidator(() => live),
    );
    expect(control.errors).toBeNull();

    live = new Set(['alive']);
    control.updateValueAndValidity();
    expect(control.errors).toEqual({ deadId: { id: 'gone' } });
  });
});

describe('deadIdValidator (products: only the checked ids are known)', () => {
  it('flags an id the lookup positively reported as gone', () => {
    const control = new FormControl(
      'gone',
      deadIdValidator(() => new Set(['gone'])),
    );
    expect(control.errors).toEqual({ deadId: { id: 'gone' } });
  });

  it('accepts an id picked after load, which was never in the checked batch', () => {
    // The distinction that matters. The set holds the configured ids that came
    // back empty, not every live product, so asking "is this live" of it would
    // condemn every fresh pick. This is the bug the admin unit suite caught.
    const control = new FormControl(
      'freshly-picked',
      deadIdValidator(() => new Set(['gone'])),
    );
    expect(control.errors).toBeNull();
  });

  it('stays quiet until the lookup settles, and if it fails', () => {
    const control = new FormControl(
      'anything',
      deadIdValidator(() => null),
    );
    expect(control.errors).toBeNull();
  });

  it('leaves an empty control to the required validator', () => {
    const control = new FormControl(
      '',
      deadIdValidator(() => new Set(['gone'])),
    );
    expect(control.errors).toBeNull();
  });
});
