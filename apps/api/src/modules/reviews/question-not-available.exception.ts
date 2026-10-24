import { BadRequestException } from '@nestjs/common';

/**
 * Caller (storefront answer form or admin answer dialog) tried to answer a
 * `ProductQuestion` whose status is `HIDDEN`. Hidden questions are admin-
 * moderated and must not accept new answers. This exception carries a
 * stable error code so both clients can map it to a localized message —
 * see `specs/features/full-stack-audit-2026-05-14/plan.md` §1.1 row #2.
 */
export class QuestionNotAvailableForAnswerException extends BadRequestException {
  static readonly CODE = 'QUESTION_NOT_AVAILABLE_FOR_ANSWER' as const;

  constructor() {
    super({
      error: {
        code: QuestionNotAvailableForAnswerException.CODE,
        message: 'This question is not available for answers',
      },
    });
  }
}
