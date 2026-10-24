import { acceptFaqSuggestionsSchema, faqItemSchema } from './geo';

describe('faqItemSchema', () => {
  it('parses a valid item with Translatable question + answer', () => {
    const result = faqItemSchema.safeParse({
      question: {
        default: "Livrez-vous à l'international ?",
        fr: "Livrez-vous à l'international ?",
      },
      answer: { default: 'Oui, partout en France.', fr: 'Oui, partout en France.' },
      sortOrder: 0,
    });
    expect(result.success).toBe(true);
  });

  it('parses without sortOrder (optional)', () => {
    const result = faqItemSchema.safeParse({
      question: { default: 'q' },
      answer: { default: 'a' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a negative sortOrder', () => {
    const result = faqItemSchema.safeParse({
      question: { default: 'q' },
      answer: { default: 'a' },
      sortOrder: -1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-string value in question record', () => {
    const result = faqItemSchema.safeParse({
      question: { default: 42 },
      answer: { default: 'a' },
    });
    expect(result.success).toBe(false);
  });
});

describe('acceptFaqSuggestionsSchema', () => {
  it('parses a single-item batch', () => {
    const result = acceptFaqSuggestionsSchema.safeParse({
      faqs: [
        {
          question: { default: 'q' },
          answer: { default: 'a' },
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('parses an empty batch (audit-pass — backend DTO does not require non-empty)', () => {
    const result = acceptFaqSuggestionsSchema.safeParse({ faqs: [] });
    expect(result.success).toBe(true);
  });

  it('rejects a malformed nested item', () => {
    const result = acceptFaqSuggestionsSchema.safeParse({
      faqs: [{ question: 'not-an-object', answer: { default: 'a' } }],
    });
    expect(result.success).toBe(false);
  });
});
