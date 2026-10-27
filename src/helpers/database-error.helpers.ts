/** Safe identifiers only: Prisma messages can contain SQL, parameters or connection URLs. */
export function databaseErrorContext(error: unknown) {
  const object = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const value = object(error),
    meta = object(value.meta);
  const cause = object(object(meta.driverAdapterError).cause);
  const prismaCode =
    typeof value.code === 'string' && /^P\d{4}$/.test(value.code) ? value.code : undefined;
  const state = [cause.originalCode, meta.code, value.code].find(
    (code) => typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code),
  );

  return {
    errorType: error instanceof Error ? error.name : 'UnknownError',
    prismaCode,
    sqlState: state as string | undefined,
  };
}

export function isTransientDatabaseError(error: unknown) {
  const { prismaCode, sqlState } = databaseErrorContext(error);

  return (
    ['P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'P2028', 'P2034'].includes(prismaCode ?? '') ||
    /^(08...|40001|40P01|55P03|57014|57P01|53300|25P04)$/.test(sqlState ?? '')
  );
}
