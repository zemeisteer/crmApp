// A unique-index violation from node-postgres, possibly wrapped by drizzle.
export function isUniqueViolation(err: unknown, constraint: string) {
  const top = err as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  const pg = top?.cause ?? top;
  return (pg?.code === '23505' && pg.constraint === constraint) || (top?.code === '23505' && top.constraint === constraint);
}
