import type { User } from "./api";

const FULL = ["OWNER", "ADMIN", "SUPERADMIN"];

/**
 * Whether the signed-in member may do `key` (an item of the server's access
 * catalog). The server sends each member's list; the owner and admins can do
 * everything. The server checks again on every request - this only keeps
 * buttons that would be refused out of sight.
 */
export function can(user: Pick<User, "role" | "access"> | null | undefined, key: string): boolean {
  if (!user) return false;
  if (FULL.includes(user.role)) return true;
  return Array.isArray(user.access) && user.access.includes(key);
}
