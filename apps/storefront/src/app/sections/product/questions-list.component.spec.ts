import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { LocaleService } from '../../locale.service';
import { assertAxeClean, renderComponent } from '../../ui/testing';
import { QuestionsListComponent, type QuestionRow } from './questions-list.component';

const baseQuestions: QuestionRow[] = [
  {
    id: 'q1',
    question: 'Does it support wireless charging?',
    authorName: 'Amel B.',
    createdAt: '2026-04-01T00:00:00Z',
    answer: {
      authorName: 'Store team',
      body: 'Yes, the case supports Qi wireless charging.',
      isAdminAnswer: true,
    },
  },
  {
    id: 'q2',
    question: 'How long does the battery last?',
    createdAt: '2026-04-02T00:00:00Z',
    answer: null,
  },
];

describe('QuestionsListComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());
  afterEach(() => TestBed.resetTestingModule());

  it('renders one entry per question with the body and admin answer', async () => {
    const fixture = await renderComponent(QuestionsListComponent, { questions: baseQuestions }, [
      provideRouter([]),
      LocaleService,
    ]);
    const entries = fixture.nativeElement.querySelectorAll('.entry');
    expect(entries.length).toBe(2);
    const adminAnswer = fixture.nativeElement.querySelector('.answer.admin');
    expect(adminAnswer).not.toBeNull();
    expect(adminAnswer?.querySelector('.answer-body')?.textContent).toContain('Qi');
  });

  it('badges the store answer, attributes the asker, and hides the answer control', async () => {
    const fixture = await renderComponent(
      QuestionsListComponent,
      { questions: baseQuestions, authed: true },
      [provideRouter([]), LocaleService],
    );
    const root = fixture.nativeElement as HTMLElement;

    // The answer the API has always sent, finally on screen.
    expect(root.querySelector('[data-testid="product-question-answer-q1"]')?.textContent).toContain(
      'Qi',
    );
    expect(
      root.querySelector('[data-testid="product-question-answer-badge-q1"]')?.textContent?.trim(),
    ).toBe('Store team');
    expect(root.querySelector('[data-testid="product-question-asker-q1"]')?.textContent).toContain(
      'Amel B.',
    );

    // One answer column: offering the control next to an answer offers to
    // erase it.
    expect(root.querySelector('[data-testid="product-question-answer-toggle-q1"]')).toBeNull();
    expect(root.querySelector('[data-testid="product-question-answer-toggle-q2"]')).not.toBeNull();
  });

  it('falls back to the localized anonymous label when the asker has no name', async () => {
    const fixture = await renderComponent(
      QuestionsListComponent,
      { questions: [{ ...baseQuestions[0], authorName: '' }] },
      [provideRouter([]), LocaleService],
    );
    // The bare LocaleService resolves to the storefront default locale, so the
    // label is read from the same strings the component renders.
    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelector('[data-testid="product-question-asker-q1"]')
        ?.textContent?.trim(),
    ).toBe(TestBed.inject(LocaleService).strings().product.questions.anonymous);
  });

  it('renders cross-locale text with dir=auto and the stored lang', async () => {
    const fixture = await renderComponent(
      QuestionsListComponent,
      {
        questions: [
          {
            ...baseQuestions[0],
            question: 'Livraison a l’international ?',
            questionLocale: 'fr',
          },
        ],
      },
      [provideRouter([]), LocaleService],
    );
    const root = fixture.nativeElement as HTMLElement;
    const question = root.querySelector('.question') as HTMLElement;
    expect(question.getAttribute('dir')).toBe('auto');
    expect(question.getAttribute('lang')).toBe('fr');
    const answer = root.querySelector('.answer-body') as HTMLElement;
    expect(answer.getAttribute('dir')).toBe('auto');
  });

  it('renders the empty state when no questions exist', async () => {
    const fixture = await renderComponent(QuestionsListComponent, { questions: [] }, [
      provideRouter([]),
      LocaleService,
    ]);
    expect(fixture.nativeElement.querySelector('app-empty-state')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.list')).toBeNull();
  });

  it('offers show-more while published questions remain, and no dead anchor', async () => {
    const fixture = await renderComponent(
      QuestionsListComponent,
      { questions: baseQuestions, total: 12 },
      [provideRouter([]), LocaleService],
    );
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.view-all')).toBeNull();
    expect(root.querySelector('[data-testid="product-questions-show-more"]')).not.toBeNull();
  });

  it('hides show-more once every published question is on screen', async () => {
    const fixture = await renderComponent(
      QuestionsListComponent,
      { questions: baseQuestions, total: baseQuestions.length },
      [provideRouter([]), LocaleService],
    );
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="product-questions-show-more"]',
      ),
    ).toBeNull();
  });

  it('emits loadMore when show-more is clicked', async () => {
    const fixture = await renderComponent(
      QuestionsListComponent,
      { questions: baseQuestions, total: 12 },
      [provideRouter([]), LocaleService],
    );
    let emitted = 0;
    fixture.componentInstance.loadMore.subscribe(() => (emitted += 1));
    (
      (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="product-questions-show-more"]',
      ) as HTMLButtonElement
    ).click();
    expect(emitted).toBe(1);
  });

  it('passes axe', async () => {
    const fixture = await renderComponent(QuestionsListComponent, { questions: baseQuestions }, [
      provideRouter([]),
      LocaleService,
    ]);
    await assertAxeClean(fixture.nativeElement);
  });

  it('hides helpful button for anonymous visitors', async () => {
    const data: QuestionRow[] = [
      { ...baseQuestions[0], helpfulCount: 2, votedHelpful: false, status: 'PUBLISHED' },
    ];
    const fixture = await renderComponent(QuestionsListComponent, { questions: data }, [
      provideRouter([]),
      LocaleService,
    ]);
    expect(
      fixture.nativeElement.querySelector('[data-testid="product-question-helpful-q1"]'),
    ).toBeNull();
  });

  it('shows helpful button for authed users on PUBLISHED questions', async () => {
    const data: QuestionRow[] = [
      { ...baseQuestions[0], helpfulCount: 2, votedHelpful: false, status: 'PUBLISHED' },
    ];
    const fixture = await renderComponent(
      QuestionsListComponent,
      { questions: data, authed: true },
      [provideRouter([]), LocaleService],
    );
    expect(
      fixture.nativeElement.querySelector('[data-testid="product-question-helpful-q1"]'),
    ).not.toBeNull();
  });

  it('emits helpfulToggle with nextVoted toggled when clicked', async () => {
    const fixture = await renderComponent(
      QuestionsListComponent,
      {
        questions: [
          { ...baseQuestions[0], helpfulCount: 1, votedHelpful: false, status: 'PUBLISHED' },
        ],
        authed: true,
      },
      [provideRouter([]), LocaleService],
    );
    const spy = vi.fn();
    fixture.componentInstance.helpfulToggle.subscribe(spy);
    (
      fixture.nativeElement.querySelector(
        '[data-testid="product-question-helpful-q1"]',
      ) as HTMLButtonElement
    ).click();
    expect(spy).toHaveBeenCalledWith({ questionId: 'q1', nextVoted: true });
  });

  it('hides helpful button on PENDING questions', async () => {
    const fixture = await renderComponent(
      QuestionsListComponent,
      {
        questions: [{ ...baseQuestions[0], status: 'PENDING' as const }],
        authed: true,
      },
      [provideRouter([]), LocaleService],
    );
    expect(
      fixture.nativeElement.querySelector('[data-testid="product-question-helpful-q1"]'),
    ).toBeNull();
    expect(
      fixture.nativeElement.querySelector('[data-testid="product-question-pending-q1"]'),
    ).not.toBeNull();
  });

  it('opens the answer form when the answer-toggle is clicked + emits the answer payload on submit', async () => {
    const fixture = await renderComponent(
      QuestionsListComponent,
      {
        questions: [{ ...baseQuestions[1], status: 'PUBLISHED' as const }],
        authed: true,
      },
      [provideRouter([]), LocaleService],
    );
    const spy = vi.fn();
    fixture.componentInstance.answerSubmitted.subscribe(spy);
    (
      fixture.nativeElement.querySelector(
        '[data-testid="product-question-answer-toggle-q2"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    const ta = fixture.nativeElement.querySelector(
      '[data-testid="product-question-answer-input-q2"]',
    ) as HTMLTextAreaElement;
    ta.value = '  About 6 hours per charge.  ';
    ta.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (
      fixture.nativeElement.querySelector(
        '[data-testid="product-question-answer-form-q2"]',
      ) as HTMLFormElement
    ).dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    expect(spy).toHaveBeenCalledWith({
      questionId: 'q2',
      payload: { answer: 'About 6 hours per charge.' },
    });
  });

  it('blocks answer submit on whitespace-only input', async () => {
    const fixture = await renderComponent(
      QuestionsListComponent,
      {
        questions: [{ ...baseQuestions[1], status: 'PUBLISHED' as const }],
        authed: true,
      },
      [provideRouter([]), LocaleService],
    );
    const spy = vi.fn();
    fixture.componentInstance.answerSubmitted.subscribe(spy);
    (
      fixture.nativeElement.querySelector(
        '[data-testid="product-question-answer-toggle-q2"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    const ta = fixture.nativeElement.querySelector(
      '[data-testid="product-question-answer-input-q2"]',
    ) as HTMLTextAreaElement;
    ta.value = '   ';
    ta.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (
      fixture.nativeElement.querySelector(
        '[data-testid="product-question-answer-form-q2"]',
      ) as HTMLFormElement
    ).dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    expect(spy).not.toHaveBeenCalled();
  });
});
