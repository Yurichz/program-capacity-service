import { ApiResult } from '#interfaces/api-result.js';

export async function paginate<T>(
  read: (skip: number, take: number) => Promise<T[]>,
  count: () => Promise<number>,
  page = 1,
  perPage = 10,
): Promise<ApiResult<T[]>> {
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(perPage) ||
    perPage < 1 ||
    perPage > 100
  ) {
    throw new RangeError('Invalid pagination');
  }
  const [data, total] = await Promise.all([read((page - 1) * perPage, perPage), count()]);
  const lastPage = Math.max(1, Math.ceil(total / perPage));
  return new ApiResult(data, {
    total,
    lastPage,
    currentPage: page,
    perPage,
    prev: page > 1 ? page - 1 : null,
    next: page < lastPage ? page + 1 : null,
  });
}
