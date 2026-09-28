import { NextResponse, type NextRequest } from "next/server";
import { ROOT_DOMAIN, subdomainFromHost } from "@/lib/domain";

// Center sites on their own subdomain: <sub>.<ROOT_DOMAIN>/ shows the page
// at /site/<sub> (the address bar keeps the subdomain). Other paths on a
// center subdomain (/login, /t/<token>, /portal ...) work as usual. On the
// main domain, old /site/<sub> links move to the subdomain.
export function proxy(request: NextRequest) {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const { pathname } = request.nextUrl;
  const sub = subdomainFromHost(host);

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
