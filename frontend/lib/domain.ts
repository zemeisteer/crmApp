// Where centers live on the web: every center gets `<subdomain>.<ROOT_DOMAIN>`
// (e.g. ilmmarkazi.talimcrm.uz) once the main domain is set with
// NEXT_PUBLIC_ROOT_DOMAIN. In development `<subdomain>.localhost:3000` works
// the same way (browsers send *.localhost to this machine).

export const ROOT_DOMAIN = (process.env.NEXT_PUBLIC_ROOT_DOMAIN || "crmapp.com").trim().toLowerCase().replace(/^\.+|\.+$/g, "");

// Labels that are never a center (the app itself, mail, etc.).
export const RESERVED_SUBDOMAINS = new Set(["www", "app", "api", "admin", "mail", "static", "cdn"]);

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** The center's host name, e.g. "ilmmarkazi.talimcrm.uz". */
export function centerHost(subdomain: string) {
  return `${subdomain}.${ROOT_DOMAIN}`;
}

/**
 * The center subdomain a request host points at, or null for the main site.
 * "ilm.talimcrm.uz" -> "ilm", "ilm.localhost:3000" -> "ilm",
 * "talimcrm.uz" / "www.talimcrm.uz" / "a.b.talimcrm.uz" -> null.
 */
export function subdomainFromHost(host: string | null | undefined): string | null {
  if (!host) return null;
  const name = host.toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  const base = [ROOT_DOMAIN, "localhost"].find((d) => name.endsWith(`.${d}`));
  if (!base) return null;
  const label = name.slice(0, -(base.length + 1));
  if (!LABEL.test(label) || RESERVED_SUBDOMAINS.has(label)) return null;
  return label;
}

/**
 * Full link to a center's public site. On a dev machine (localhost) it stays
 * on this machine and port; everywhere else it is https://<sub>.<ROOT_DOMAIN>.
 */
export function centerSiteUrl(subdomain: string) {
  if (typeof window !== "undefined") {
    const { protocol, hostname, port } = window.location;
    if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "127.0.0.1") {
      return `${protocol}//${subdomain}.localhost${port ? `:${port}` : ""}`;
    }
  }
  return `https://${centerHost(subdomain)}`;
}
