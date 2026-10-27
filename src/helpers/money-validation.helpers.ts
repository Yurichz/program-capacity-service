import { ValidateBy, type ValidationArguments } from 'class-validator';
import { currencySchema, parseMoney } from './capacity.helpers.js';

export function IsInvoiceAmount() {
  return ValidateBy({
    name: 'isInvoiceAmount',
    validator: {
      validate(value: unknown, args?: ValidationArguments): boolean {
        const currency = currencySchema.safeParse(
          (args?.object as { currency?: unknown } | undefined)?.currency,
        );

        if (typeof value !== 'string' || !currency.success) return false;

        try {
          parseMoney(value, currency.data);

          return true;
        } catch {
          return false;
        }
      },
      defaultMessage: () =>
        'Amount must be positive, fit BIGINT and match the invoice currency scale',
    },
  });
}
