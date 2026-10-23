import { NextResponse, type NextRequest } from "next/server";
import { ROOT_DOMAIN, customHost, subdomainFromHost } from "@/lib/domain";

// A center's own domain (custom-domains/ in the API): which center it is,
// asked once a minute per host. Only verified domains answer.
const CUSTOM_TTL_MS = 60_000;
const customCache = new Map<string, { at: number; sub: string | null }>();
function apiBase() {
  const internal = process.env.INTERNAL_API_URL?.trim();
  if (internal) return internal.replace(/\/$/, "");
  const pub = process.env.NEXT_PUBLIC_API_URL?.trim() || "";
  return /^https?:\/\//.test(pub) ? pub.replace(/\/$/, "") : null;
}
async function centerOfDomain(host: string): Promise<string | null> {
  const hit = customCache.get(host);
  if (hit && Date.now() - hit.at < CUSTOM_TTL_MS) return hit.sub;
  const base = apiBase();
  if (!base) return null;
  let sub: string | null = null;
  try {
    const res = await fetch(`${base}/custom-domains/resolve/${encodeURIComponent(host)}`, { cache: "no-store" });
    if (res.ok) sub = ((await res.json()) as { subdomain?: string }).subdomain ?? null;
  } catch {
    return null; // the API is not reachable: try again next time
  }
  customCache.set(host, { at: Date.now(), sub });
  return sub;
}

// Center sites on their own subdomain: <sub>.<ROOT_DOMAIN>/ shows the page
// at /site/<sub> (the address bar keeps the subdomain). Other paths on a
// center subdomain (/login, /t/<token>, /portal ...) work as usual. On the
// main domain, old /site/<sub> links move to the subdomain.
export async function proxy(request: NextRequest) {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const { pathname } = request.nextUrl;
  const sub = subdomainFromHost(host);

  // A center's own domain: its home page is the center's site; everything
  // else (sign-in, cabinets) lives on the center's subdomain.
  const own = sub ? null : customHost(host);
  if (own) {
    const center = await centerOfDomain(own);
    if (center) {
      if (pathname === "/") {
        const url = request.nextUrl.clone();
        url.pathname = `/site/${center}`;
        return NextResponse.rewrite(url);
      }
      return NextResponse.redirect(new URL(`${pathname}${request.nextUrl.search}`, `https://${center}.${ROOT_DOMAIN}/`), 307);
    }
  }

  if (sub) {
    if (pathname === "/") {
      const url = request.nextUrl.clone();
      url.pathname = `/site/${sub}`;
      return NextResponse.rewrite(url);
    }
    return NextResponse.next();
  }

  const bare = (host ?? "").toLowerCase().replace(/:\d+$/, "");
  const m = pathname.match(/^\/site\/([a-z0-9-]+)\/?$/i);
  if (m && (bare === ROOT_DOMAIN || bare === `www.${ROOT_DOMAIN}`)) {
    const url = new URL(request.nextUrl.search, `https://${m[1].toLowerCase()}.${ROOT_DOMAIN}/`);
    return NextResponse.redirect(url, 308);
  }
  return NextResponse.next();
}

export const config = {
  // Pages only: skip Next internals and files like /site/classroom.svg.
  matcher: ["/((?!_next/|api/|.*\\.[a-zA-Z0-9]+$).*)"],
};
