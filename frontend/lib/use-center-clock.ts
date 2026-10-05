"use client";

import { useMemo } from "react";
import { useAuth } from "./auth-context";
import { centerTimeZone, centerToday, centerWallClock, isoToCenterParts } from "./center-time";

/**
 * "Today", "this month" and "which weekday" on the signed-in center's clock
 * (tenant.timezone, default Asia/Tashkent) - not the browser's. Near
 * midnight, and for anyone working from another timezone, the two differ;
 * the server reads days and months on the center's clock.
 */
export function useCenterClock() {
  const { tenant } = useAuth();
  const tz = centerTimeZone(tenant?.timezone);
  return useMemo(
    () => ({
      tz,
      /** YYYY-MM-DD */
      today: () => centerToday(tz),
      /** YYYY-MM */
      month: () => centerToday(tz).slice(0, 7),
      /** 1 = Monday ... 7 = Sunday */
      weekday: () => {
        const d = centerWallClock(new Date(), tz)!.getDay();
        return d === 0 ? 7 : d;
      },
      /** The center's calendar date (YYYY-MM-DD) of an instant. */
      dateOf: (iso: string | number | Date) => isoToCenterParts(iso, tz)?.date ?? null,
    }),
    [tz],
  );
}
