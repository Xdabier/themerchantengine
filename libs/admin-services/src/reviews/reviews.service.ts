import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ADMIN_API_ROUTES, adminRoute, fillRoute } from '@admin-routes';
import { ADMIN_API_BASE_URL, envelope, toParams } from '../shared';
import {
  adminUpdateReviewRequestSchema,
  type AdminUpdateReviewRequest,
  answerQuestionRequestSchema,
  type AnswerQuestionRequest,
  listQuestionsQuerySchema,
  type ListQuestionsQuery,
  listQuestionsResponseSchema,
  type ListQuestionsResponse,
  listReviewsQuerySchema,
  type ListReviewsQuery,
  listReviewsResponseSchema,
  type ListReviewsResponse,
  moderateRequestSchema,
  type ModerateRequest,
  questionSchema,
  type Question,
  reviewSchema,
  type Review,
} from './reviews.schemas';

const REVIEWS = ADMIN_API_ROUTES.reviews;

/** `/v1/admin/reviews` + `/v1/admin/questions`. */
@Injectable({ providedIn: 'root' })
export class ReviewsService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = inject(ADMIN_API_BASE_URL);

  listReviews(query: ListReviewsQuery = {}): Observable<ListReviewsResponse> {
    const parsed = listReviewsQuerySchema.parse(query);
    const params = new HttpParams({ fromObject: toParams(parsed as never) });
    return this.http
      .get<unknown>(`${this.apiBase}/${adminRoute(REVIEWS.base, REVIEWS.reviews)}`, {
        params,
        withCredentials: true,
      })
      .pipe(map((raw) => listReviewsResponseSchema.parse(raw)));
  }

  approveReview(id: string): Observable<Review> {
    return this.http
      .patch<unknown>(
        `${this.apiBase}/${adminRoute(REVIEWS.base, fillRoute(REVIEWS.reviewApprove, { id }))}`,
        {},
        { withCredentials: true },
      )
      .pipe(map((raw) => reviewSchema.parse(envelope(raw))));
  }

  rejectReview(id: string, input: ModerateRequest = {}): Observable<Review> {
    const body = moderateRequestSchema.parse(input);
    return this.http
      .patch<unknown>(
        `${this.apiBase}/${adminRoute(REVIEWS.base, fillRoute(REVIEWS.reviewReject, { id }))}`,
        body,
        {
          withCredentials: true,
        },
      )
      .pipe(map((raw) => reviewSchema.parse(envelope(raw))));
  }

  updateReview(id: string, input: AdminUpdateReviewRequest): Observable<Review> {
    const body = adminUpdateReviewRequestSchema.parse(input);
    return this.http
      .patch<unknown>(
        `${this.apiBase}/${adminRoute(REVIEWS.base, fillRoute(REVIEWS.reviewById, { id }))}`,
        body,
        {
          withCredentials: true,
        },
      )
      .pipe(map((raw) => reviewSchema.parse(envelope(raw))));
  }

  deleteReview(id: string): Observable<void> {
    return this.http
      .delete<void>(
        `${this.apiBase}/${adminRoute(REVIEWS.base, fillRoute(REVIEWS.reviewById, { id }))}`,
        { withCredentials: true },
      )
      .pipe(map(() => undefined));
  }

  listQuestions(query: ListQuestionsQuery = {}): Observable<ListQuestionsResponse> {
    const parsed = listQuestionsQuerySchema.parse(query);
    const params = new HttpParams({ fromObject: toParams(parsed as never) });
    return this.http
      .get<unknown>(`${this.apiBase}/${adminRoute(REVIEWS.base, REVIEWS.questions)}`, {
        params,
        withCredentials: true,
      })
      .pipe(map((raw) => listQuestionsResponseSchema.parse(raw)));
  }

  approveQuestion(id: string): Observable<Question> {
    return this.http
      .patch<unknown>(
        `${this.apiBase}/${adminRoute(REVIEWS.base, fillRoute(REVIEWS.questionApprove, { id }))}`,
        {},
        { withCredentials: true },
      )
      .pipe(map((raw) => questionSchema.parse(envelope(raw))));
  }

  rejectQuestion(id: string, input: ModerateRequest = {}): Observable<Question> {
    const body = moderateRequestSchema.parse(input);
    return this.http
      .patch<unknown>(
        `${this.apiBase}/${adminRoute(REVIEWS.base, fillRoute(REVIEWS.questionReject, { id }))}`,
        body,
        {
          withCredentials: true,
        },
      )
      .pipe(map((raw) => questionSchema.parse(envelope(raw))));
  }

  answerQuestion(id: string, input: AnswerQuestionRequest): Observable<Question> {
    const body = answerQuestionRequestSchema.parse(input);
    return this.http
      .post<unknown>(
        `${this.apiBase}/${adminRoute(REVIEWS.base, fillRoute(REVIEWS.questionAnswer, { id }))}`,
        body,
        {
          withCredentials: true,
        },
      )
      .pipe(map((raw) => questionSchema.parse(envelope(raw))));
  }
}
