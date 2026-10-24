import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ADMIN_API_ROUTES, adminRoute, fillRoute } from '@admin-routes';
import { ADMIN_API_BASE_URL, envelope, toParams } from '../shared';
import {
  adjustGiftCardBalanceRequestSchema,
  type AdjustGiftCardBalanceRequest,
  createGiftCardRequestSchema,
  type CreateGiftCardRequest,
  giftCardSchema,
  type GiftCard,
  listGiftCardsQuerySchema,
  type ListGiftCardsQuery,
  listGiftCardsResponseSchema,
  type ListGiftCardsResponse,
  resendGiftCardEmailResponseSchema,
  type ResendGiftCardEmailResponse,
  updateGiftCardRequestSchema,
  type UpdateGiftCardRequest,
} from './gift-cards.schemas';

const GIFT_CARDS = ADMIN_API_ROUTES.giftCards;

/** `/v1/admin/gift-cards/*`. Pass purchasedBy=null (string literal) to list store credit. */
@Injectable({ providedIn: 'root' })
export class GiftCardsService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = inject(ADMIN_API_BASE_URL);

  list(query: ListGiftCardsQuery = {}): Observable<ListGiftCardsResponse> {
    const parsed = listGiftCardsQuerySchema.parse(query);
    const params = new HttpParams({ fromObject: toParams(parsed as never) });
    return this.http
      .get<unknown>(`${this.apiBase}/${adminRoute(GIFT_CARDS.base, GIFT_CARDS.adminList)}`, {
        params,
        withCredentials: true,
      })
      .pipe(map((raw) => listGiftCardsResponseSchema.parse(raw)));
  }

  issue(input: CreateGiftCardRequest): Observable<GiftCard> {
    const body = createGiftCardRequestSchema.parse(input);
    return this.http
      .post<unknown>(`${this.apiBase}/${adminRoute(GIFT_CARDS.base, GIFT_CARDS.adminList)}`, body, {
        withCredentials: true,
      })
      .pipe(map((raw) => giftCardSchema.parse(envelope(raw))));
  }

  get(id: string): Observable<GiftCard> {
    return this.http
      .get<unknown>(
        `${this.apiBase}/${adminRoute(GIFT_CARDS.base, fillRoute(GIFT_CARDS.adminById, { id }))}`,
        { withCredentials: true },
      )
      .pipe(map((raw) => giftCardSchema.parse(envelope(raw))));
  }

  update(id: string, input: UpdateGiftCardRequest): Observable<GiftCard> {
    const body = updateGiftCardRequestSchema.parse(input);
    return this.http
      .patch<unknown>(
        `${this.apiBase}/${adminRoute(GIFT_CARDS.base, fillRoute(GIFT_CARDS.adminById, { id }))}`,
        body,
        {
          withCredentials: true,
        },
      )
      .pipe(map((raw) => giftCardSchema.parse(envelope(raw))));
  }

  /** Apply a signed balance delta (positive = credit, negative = debit). */
  adjustBalance(id: string, input: AdjustGiftCardBalanceRequest): Observable<GiftCard> {
    const body = adjustGiftCardBalanceRequestSchema.parse(input);
    return this.http
      .post<unknown>(
        `${this.apiBase}/${adminRoute(GIFT_CARDS.base, fillRoute(GIFT_CARDS.adjust, { id }))}`,
        body,
        {
          withCredentials: true,
        },
      )
      .pipe(map((raw) => giftCardSchema.parse(envelope(raw))));
  }

  /** Re-queue the redemption email. Fire-and-forget from the UI side. */
  resendEmail(id: string): Observable<ResendGiftCardEmailResponse> {
    return this.http
      .post<unknown>(
        `${this.apiBase}/${adminRoute(GIFT_CARDS.base, fillRoute(GIFT_CARDS.resend, { id }))}`,
        {},
        { withCredentials: true },
      )
      .pipe(map((raw) => resendGiftCardEmailResponseSchema.parse(envelope(raw))));
  }
}
