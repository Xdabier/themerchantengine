import type { ValidationError } from 'class-validator';

import { flattenValidationErrors } from './validation-errors';

/**
 * The defect these pin: a `@ValidateNested()` failure answered
 * `400 {"field":"description","messages":[]}`. Every assertion below is on the
 * POSITIVE form, a non-empty message naming the real property, because "the
 * details array is not empty" is the exact property that was missing.
 */

function error(
  property: string,
  constraints?: Record<string, string>,
  children?: ValidationError[],
): ValidationError {
  return { property, constraints, children } as ValidationError;
}

describe('flattenValidationErrors', () => {
  it('reports a flat constraint failure as it always did', () => {
    expect(flattenValidationErrors([error('slug', { matches: 'slug must be lowercase' })])).toEqual(
      [{ field: 'slug', messages: ['slug must be lowercase'] }],
    );
  });

  it('reports the child reason of a nested failure, not an empty list', () => {
    const errors = [
      error('description', undefined, [
        error('default', { isNotEmpty: 'default should not be empty' }),
      ]),
    ];

    expect(flattenValidationErrors(errors)).toEqual([
      { field: 'description.default', messages: ['default should not be empty'] },
    ]);
  });

  it('names an unknown locale key rejected by forbidNonWhitelisted', () => {
    const errors = [
      error('description', undefined, [
        error('ar', { whitelistValidation: 'property ar should not exist' }),
      ]),
    ];

    const details = flattenValidationErrors(errors);

    expect(details).toEqual([
      { field: 'description.ar', messages: ['property ar should not exist'] },
    ]);
    // Three different causes used to produce the same empty array. The field
    // path is what tells them apart.
    expect(details[0].field).not.toBe('description');
  });

  it('keeps a parent that fails on its own terms as well as through a child', () => {
    const errors = [
      error('description', { isObject: 'description must be an object' }, [
        error('default', { isString: 'default must be a string' }),
      ]),
    ];

    expect(flattenValidationErrors(errors)).toEqual([
      { field: 'description', messages: ['description must be an object'] },
      { field: 'description.default', messages: ['default must be a string'] },
    ]);
  });

  it('walks more than one level down', () => {
    const errors = [
      error('shippingAddress', undefined, [
        error('contact', undefined, [error('phone', { matches: 'Invalid phone number format' })]),
      ]),
    ];

    expect(flattenValidationErrors(errors)).toEqual([
      { field: 'shippingAddress.contact.phone', messages: ['Invalid phone number format'] },
    ]);
  });

  it('reports every failing sibling, not just the first', () => {
    const errors = [
      error('name', undefined, [
        error('default', { isNotEmpty: 'default should not be empty' }),
        error('fr', { isString: 'fr must be a string' }),
      ]),
    ];

    expect(flattenValidationErrors(errors).map((d) => d.field)).toEqual([
      'name.default',
      'name.fr',
    ]);
  });

  it('never emits a detail with no messages when there is a reason to give', () => {
    const errors = [
      error('description', undefined, [error('ar', { whitelistValidation: 'nope' })]),
      error('slug', { matches: 'bad slug' }),
    ];

    for (const detail of flattenValidationErrors(errors)) {
      expect(detail.messages.length).toBeGreaterThan(0);
    }
  });
});
