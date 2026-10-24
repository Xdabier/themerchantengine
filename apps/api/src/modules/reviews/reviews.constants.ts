import { ReviewStatus, QuestionStatus } from '@prisma/client';

// ── Sort field allowlists ────────────────────────────────────────────────────

export const VALID_REVIEW_SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'rating',
  'helpfulCount',
] as const;

export const VALID_QUESTION_SORT_FIELDS = ['createdAt', 'updatedAt', 'helpfulCount'] as const;

// ── Entity type constants (HelpfulVote polymorphism) ─────────────────────────

export const HELPFUL_ENTITY_TYPE = {
  REVIEW: 'review',
  QUESTION: 'question',
} as const;

// ── Events ───────────────────────────────────────────────────────────────────

export const REVIEW_EVENTS = {
  CREATED: 'review.created',
  APPROVED: 'review.approved',
  REJECTED: 'review.rejected',
  DELETED: 'review.deleted',
} as const;

export const QUESTION_EVENTS = {
  CREATED: 'question.created',
  ANSWERED: 'question.answered',
  APPROVED: 'question.approved',
  REJECTED: 'question.rejected',
} as const;

// ── Moderation transition maps ────────────────────────────────────────────────

/** Allowed target statuses when moderating a review. */
export const REVIEW_MODERATION_ALLOWED: ReviewStatus[] = [
  ReviewStatus.PUBLISHED,
  ReviewStatus.HIDDEN,
];

/** Allowed target statuses when moderating a question. */
export const QUESTION_MODERATION_ALLOWED: QuestionStatus[] = [
  QuestionStatus.PUBLISHED,
  QuestionStatus.HIDDEN,
];
