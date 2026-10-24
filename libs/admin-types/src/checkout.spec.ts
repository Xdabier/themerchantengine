import { CHECKOUT_REQUIRED_FIELDS, updateCheckoutSettingsSchema } from './checkout';

describe('updateCheckoutSettingsSchema', () => {
  it('parses a fully-populated valid object', () => {
    const result = updateCheckoutSettingsSchema.safeParse({
      guestCheckoutEnabled: true,
      requiredFields: ['email', 'phone'],
      termsOfServiceUrl: 'https://example.com/tos',
      postPurchaseRedirectUrl: 'https://example.com/thanks',
      checkoutMessage: 'Welcome to checkout.',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a requiredFields entry that is not in the allowlist', () => {
    const result = updateCheckoutSettingsSchema.safeParse({
      requiredFields: ['email', 'taxId'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a malformed termsOfServiceUrl', () => {
    const result = updateCheckoutSettingsSchema.safeParse({
      termsOfServiceUrl: 'not-a-url',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a checkoutMessage longer than 500 chars', () => {
    const result = updateCheckoutSettingsSchema.safeParse({
      checkoutMessage: 'A'.repeat(501),
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-boolean guestCheckoutEnabled', () => {
    const result = updateCheckoutSettingsSchema.safeParse({
      guestCheckoutEnabled: 'yes',
    });
    expect(result.success).toBe(false);
  });

  it('rejects duplicate requiredFields entries (backend @ArrayUnique parity)', () => {
    const result = updateCheckoutSettingsSchema.safeParse({
      requiredFields: ['email', 'email'],
    });
    expect(result.success).toBe(false);
  });

  it('pins the CHECKOUT_REQUIRED_FIELDS tuple shape (mirrors backend DTO)', () => {
    expect(CHECKOUT_REQUIRED_FIELDS).toEqual([
      'email',
      'phone',
      'shippingAddress',
      'billingAddress',
      'company',
      'note',
    ]);
  });
});
