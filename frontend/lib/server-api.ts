// The API as the Next.js server reaches it (metadata, sitemap, the site's
// front door): INTERNAL_API_URL inside the stack, else an absolute public
// API address (development). Null when only a relative /api is known.
export function serverApiBase(): string | null {
  const internal = process.env.INTERNAL_API_URL?.trim();
  if (internal) return internal.replace(/\/$/, "");
  const pub = process.env.NEXT_PUBLIC_API_URL?.trim() || "";
  return /^https?:\/\//.test(pub) ? pub.replace(/\/$/, "") : null;
}

/** GET from the API on the server; null on any failure (pages render without it). */
export async function serverGet<T>(path: string, revalidate = 300): Promise<T | null> {
  const base = serverApiBase();
  if (!base) return null;
  try {
    const res = await fetch(`${base}${path}`, { next: { revalidate } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
