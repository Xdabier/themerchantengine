import { NotFoundException } from '@nestjs/common';

/**
 * Question lookup by id returned no row. 4 call sites for admin moderate /
 * answer / report paths.
 */
export class ReviewQuestionNotFoundException extends NotFoundException {
  static readonly CODE = 'REVIEW_QUESTION_NOT_FOUND' as const;

  constructor(questionId?: string) {
    super({
      error: {
        code: ReviewQuestionNotFoundException.CODE,
        message: questionId ? `Question "${questionId}" not found` : 'Question not found',
      },
    });
  }
}
