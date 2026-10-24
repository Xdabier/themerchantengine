/**
 * Standard API response format
 * Follows: { data: T, meta?: { page, pageSize, total } }
 */
export interface ApiResponse<T> {
  data: T;
  meta?: PaginationMeta;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages?: number;
}

/**
 * Standard error response format
 * Follows: { error: { code: string, message: string } }
 */
export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
