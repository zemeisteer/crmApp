/** Days a group counts as new on the center's site and dashboard. */
export const NEW_GROUP_DAYS = 30;

/** Opened in the last NEW_GROUP_DAYS days, or starting later than today. */
export function isNewGroup(g: { createdAt: Date; startDate: Date | null }, now = Date.now()) {
  return now - g.createdAt.getTime() < NEW_GROUP_DAYS * 86_400_000 || (!!g.startDate && g.startDate.getTime() > now);
}
