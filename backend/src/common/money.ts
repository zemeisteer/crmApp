// Money columns are PostgreSQL `integer` (so'm). One value above this would
// overflow the column and fail as a server error; DTOs refuse it with a 400.
// Two billion so'm is far above any single payment, price or expense.
export const MAX_MONEY = 2_000_000_000;
