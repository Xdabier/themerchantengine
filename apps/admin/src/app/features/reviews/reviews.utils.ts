import type { BadgeTone } from '@admin-ui';
import type { QuestionStatus, ReviewStatus } from '@admin-services';

/** Shared status → brand badge tone. */
export function reviewStatusTone(status: ReviewStatus | QuestionStatus | string): BadgeTone {
  switch (status) {
    case 'PUBLISHED':
      return 'success';
    case 'PENDING':
      return 'warning';
    case 'HIDDEN':
      return 'neutral';
    default:
      return 'neutral';
  }
}

/** Render a 1-5 rating as five glyphs for screen + assistive tech. */
export function renderStars(rating: number | null | undefined): string {
  const n = Math.max(0, Math.min(5, Math.round(Number(rating ?? 0))));
  return '★★★★★☆☆☆☆☆'.slice(5 - n, 10 - n);
}

/** Person label with graceful fallback to "Anonymous" for nullish authors. */
export function reviewAuthorLabel(
  author: { firstName?: string | null; lastName?: string | null } | null | undefined,
  userId?: string | null,
): string {
  if (!author && !userId) return 'Anonymous';
  if (author) {
    const first = author.firstName ?? '';
    const last = author.lastName ?? '';
    const full = `${first} ${last}`.trim();
    if (full) return full;
  }
  if (userId) return userId;
  return 'Anonymous';
}

/** Whether the review/question is in a state where approve is still possible. */
export function canApprove(status: string | undefined | null): boolean {
  return status === 'PENDING' || status === 'HIDDEN';
}

/** Whether reject is still a valid transition. */
export function canReject(status: string | undefined | null): boolean {
  return status === 'PENDING' || status === 'PUBLISHED';
}
