import { zonedParts } from '../common/timezone';

/**
 * A fixed monthly salary for the part of `month` (YYYY-MM) the teacher
 * worked: from their start date (a day in the center's zone) to the month's
 * end. Started before the month (or no date): the whole amount; after it:
 * nothing.
 */
export function fixedShare(rate: number, startDate: Date | null, month: string, tz: string): { amount: number; fromDay: number | null } {
  if (!startDate || !rate) return { amount: rate, fromDay: null };
  const [y, m] = month.split('-').map(Number);
  const start = zonedParts(startDate, tz);
  const startKey = start.year * 12 + start.month;
  const monthKey = y * 12 + m;
  if (startKey < monthKey) return { amount: rate, fromDay: null };
  if (startKey > monthKey) return { amount: 0, fromDay: null };
  if (start.day <= 1) return { amount: rate, fromDay: null };
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { amount: Math.round((rate * (days - start.day + 1)) / days), fromDay: start.day };
}
