// The pages' Content-Security-Policy, set per request by proxy.ts. Scripts
// run only with this request's nonce (Next.js puts it on its own scripts)
// or when loaded by such a script ('strict-dynamic'): a script slipped into
// a page - a stored text shown as HTML, an injected tag - does not run.
// Styles stay inline-friendly: React's style props need it.
export function contentSecurityPolicy(nonce: string, apiUrl = process.env.NEXT_PUBLIC_API_URL || "") {
  const apiOrigin = /^https?:/.test(apiUrl) ? new URL(apiUrl).origin : "";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    `img-src 'self' data: blob: https://api.qrserver.com ${apiOrigin}`,
    `media-src 'self' blob: ${apiOrigin}`,
    `connect-src 'self' ${apiOrigin}`,
    `frame-src 'self' https://www.youtube-nocookie.com https://www.youtube.com ${apiOrigin}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join("; ").replace(/\s+;/g, ";");
}

/** A fresh nonce: 16 random bytes, base64. */
export function newNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}
