import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '../shared/api-client.token';
import { QuestionsService } from './questions.service';

const fakeQuestion = {
  id: 'q1',
  productId: 'p1',
  question: 'Is it good?',
  helpfulCount: 0,
  status: 'PUBLISHED',
  answer: null,
  isAdminAnswer: false,
  questionLocale: null,
  asker: { firstName: 'Amel', lastName: 'Ben Salah' },
  createdAt: '2026-04-25T09:00:00Z',
};

const fakeAnsweredQuestion = {
  ...fakeQuestion,
  answer: 'Yes',
  isAdminAnswer: true,
};

function mockClient(overrides: Partial<ApiClient>): ApiClient {
  return {
    get: vi.fn(async () => ({ data: fakeQuestion })),
    post: vi.fn(async () => ({ data: fakeAnsweredQuestion })),
    patch: vi.fn(),
    delete: vi.fn(),
    request: vi.fn(),
    ...overrides,
  } as unknown as ApiClient;
}

describe('QuestionsService.list / create', () => {
  it('list paginates questions under a product slug', async () => {
    const get = vi.fn(async () => ({
      data: [fakeQuestion],
      meta: { page: 1, pageSize: 25, total: 1, totalPages: 1 },
    })) as ApiClient['get'];
    const svc = new QuestionsService(mockClient({ get }));
    await svc.list('headphones');
    expect(get).toHaveBeenCalledWith(
      '/v1/products/headphones/questions',
      expect.objectContaining({ query: expect.any(Object) }),
    );
  });

  it('create posts to the per-slug questions path', async () => {
    const post = vi.fn(async () => ({ data: fakeQuestion })) as ApiClient['post'];
    const svc = new QuestionsService(mockClient({ post }));
    await svc.create('headphones', { question: 'Is it waterproof?' });
    expect(post).toHaveBeenCalledWith(
      '/v1/products/headphones/questions',
      expect.objectContaining({ question: 'Is it waterproof?' }),
    );
  });

  it('create rejects empty question', async () => {
    const svc = new QuestionsService(mockClient({}));
    await expect(svc.create('h', { question: '' })).rejects.toThrow();
  });
});

describe('QuestionsService.answer / toggleHelpful', () => {
  it('answer returns the updated question, answer column included', async () => {
    const post = vi.fn(async () => ({ data: fakeAnsweredQuestion })) as ApiClient['post'];
    const svc = new QuestionsService(mockClient({ post }));
    const result = await svc.answer('q1', { answer: 'Yes' });
    // The endpoint returns the question row. It used to be duck-parsed as an
    // "answer record" for a collection the model does not have.
    expect(result.id).toBe('q1');
    expect(result.answer).toBe('Yes');
    expect(result.isAdminAnswer).toBe(true);
    expect(post).toHaveBeenCalledWith(
      '/v1/questions/q1/answer',
      expect.objectContaining({ answer: 'Yes' }),
    );
  });

  it('answer rejects a payload that is not a question row', async () => {
    const post = vi.fn(async () => ({
      data: { id: 'a1', answer: 'Yes', isAdminAnswer: false },
    })) as ApiClient['post'];
    const svc = new QuestionsService(mockClient({ post }));
    await expect(svc.answer('q1', { answer: 'Yes' })).rejects.toThrow();
  });

  it('answer rejects empty answer body', async () => {
    const svc = new QuestionsService(mockClient({}));
    await expect(svc.answer('q1', { answer: '' })).rejects.toThrow();
  });

  it('toggleHelpful POSTs to the helpful path + parses helpful flag', async () => {
    const post = vi.fn(async () => ({ data: { helpful: true } })) as ApiClient['post'];
    const svc = new QuestionsService(mockClient({ post }));
    const result = await svc.toggleHelpful('q1');
    expect(post).toHaveBeenCalledWith('/v1/questions/q1/helpful');
    expect(result.helpful).toBe(true);
  });
});
