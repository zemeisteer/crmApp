/**
 * What the cabinet's own session token says about how it was opened. Read
 * only to choose what to offer on the page (a link, a hint): the server
 * checks the token on every request, so nothing here grants access.
 */

function payloadOf(token: string | null | undefined): Record<string, unknown> | null {
  if (!token) return null;
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const json = new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    const data: unknown = JSON.parse(json);
    return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * The cabinet was opened from a parent's own account (a PARENT user linked
 * as guardian), not with a phone and PIN: the token carries that parent's
 * user id. Such a parent also has their own calendar covering all their
 * children (/calendar, with their account's session).
 */
export function openedFromParentAccount(token: string | null | undefined): boolean {
  const p = payloadOf(token);
  return !!p && p.viewer === "parent" && typeof p.parentUserId === "string" && p.parentUserId.length > 0;
}
