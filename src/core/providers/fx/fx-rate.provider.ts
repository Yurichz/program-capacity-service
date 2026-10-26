import { Inject, Injectable, Optional } from '@nestjs/common';
import { type Currency, DIRECTION, fail } from '#helpers/capacity.helpers.js';
export type Quote = { rate: string; source: string; asOf: Date; direction: string };
export const FX_CLOCK = Symbol('fx-clock');
@Injectable()
export class FxRateProvider {
  constructor(@Optional() @Inject(FX_CLOCK) private readonly now: () => Date = () => new Date()) {}
  async quote(from: Currency, to: Currency): Promise<Quote> {
    const rates: Record<string, string> = {
      'EUR:USD': '1.10',
      'GBP:USD': '1.25',
      'JPY:USD': '0.0067',
      'KWD:USD': '3.25',
    };
    const rate = from === to ? '1' : rates[`${from}:${to}`];
    if (!rate) return fail(503, 'FX_UNAVAILABLE', 'Unsupported demo FX pair');
    return {
      rate,
      source: from === to ? 'IDENTITY' : 'DEMO_FIXTURE',
      asOf: this.now(),
      direction: DIRECTION,
    };
  }
}
export function validQuote(quote: Quote, now = new Date()): boolean {
  const age = now.getTime() - quote.asOf.getTime();
  return age >= 0 && age <= 60000 && quote.direction === DIRECTION;
}
