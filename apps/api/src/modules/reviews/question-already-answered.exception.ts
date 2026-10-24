import { ConflictException } from '@nestjs/common';

/**
 * A storefront caller tried to answer a question that already carries an
 * answer.
 *
 * The storefront answer route updates the single `ProductQuestion.answer`
 * column, so without this guard any signed-in customer could overwrite the
 * store's official reply. That only became reachable once answers started
 * rendering, which is what put an always-visible "Answer this question"
 * control next to one.
 *
 * First answer wins. Moderators keep overwrite rights through
 * `POST /v1/admin/questions/:id/answer`.
 */
export class QuestionAlreadyAnsweredException extends ConflictException {
  static readonly CODE = 'QUESTION_ALREADY_ANSWERED' as const;

  constructor() {
    super({
      error: {
        code: QuestionAlreadyAnsweredException.CODE,
        message: 'This question has already been answered',
      },
    });
  }
}
