export interface PaginationMeta {
  total: number;
  lastPage: number;
  currentPage: number;
  perPage: number;
  prev: number | null;
  next: number | null;
}

/** Internal explicit result. Plain domain objects containing `data` are not envelopes. */
export class ApiResult<T> {
  constructor(public readonly data: T, public readonly meta?: PaginationMeta) {}
}
