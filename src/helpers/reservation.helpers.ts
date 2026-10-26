import type { Reservation } from '#generated/prisma/client.js';
import { type Currency, currencySchema, formatMoney } from '#helpers/capacity.helpers.js';
export function reservationDto(r: Reservation, currency: Currency): Record<string, unknown> {
  return {
    id: r.id,
    programId: r.programId,
    invoiceId: r.invoiceId,
    amount: formatMoney(r.invoiceMinor, currencySchema.parse(r.invoiceCurrency)),
    currency: r.invoiceCurrency,
    reservedAmount: formatMoney(r.reservedMinor, currency),
    programCurrency: currency,
    fx: {
      rate: r.fxRate.toString(),
      direction: r.fxDirection,
      source: r.fxSource,
      asOf: r.fxAsOf.toISOString(),
    },
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    closedAt: r.closedAt?.toISOString() ?? null,
  };
}
