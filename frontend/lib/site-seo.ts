import type { PublicShowcaseData } from "./api.ts";

type Tenant = PublicShowcaseData["tenant"] & { customDomain?: string | null };

/** The site's address: the center's own verified domain, else its subdomain. */
export function siteUrl(t: Pick<Tenant, "subdomain" | "customDomain">, root: string): string {
  return t.customDomain ? `https://${t.customDomain}/` : `https://${t.subdomain}.${root}/`;
}

/** One or two sentences for search results: what the center wrote, else what it teaches. */
export function siteDescription(d: Pick<PublicShowcaseData, "tenant" | "site" | "subjects">): string {
  const own = (d.site?.heroSubtitle || d.site?.about || "").replace(/\s+/g, " ").trim();
  if (own) return own.length > 160 ? `${own.slice(0, 157).trimEnd()}...` : own;
  const subjects = d.subjects.map((s) => s.subject).filter(Boolean).slice(0, 5);
  const place = d.tenant.address ? ` ${d.tenant.address}.` : "";
  return subjects.length
    ? `${d.tenant.name}: ${subjects.join(", ")}.${place} Ariza qoldiring.`
    : `${d.tenant.name} o'quv markazi.${place} Ariza qoldiring.`;
}

/** schema.org EducationalOrganization, with what the site itself shows. */
export function siteJsonLd(d: Pick<PublicShowcaseData, "tenant" | "site" | "subjects" | "branches">, root: string) {
  const t = d.tenant as Tenant;
  const url = siteUrl(t, root);
  const socials = Object.values(d.site?.socials ?? {}).filter((v): v is string => !!v && /^https?:\/\//.test(v));
  if (t.telegramUsername) socials.push(`https://t.me/${t.telegramUsername.replace(/^@/, "")}`);
  return {
    "@context": "https://schema.org",
    "@type": "EducationalOrganization",
    name: t.name,
    url,
    ...(t.logoUrl ? { logo: new URL(t.logoUrl, url).toString() } : {}),
    ...(t.phone ? { telephone: t.phone } : {}),
    ...(t.email ? { email: t.email } : {}),
    ...(t.address ? { address: t.address } : {}),
    description: siteDescription(d as PublicShowcaseData),
    ...(socials.length ? { sameAs: socials } : {}),
    ...(d.subjects.length ? { knowsAbout: d.subjects.map((s) => s.subject) } : {}),
    ...(d.branches?.length ? { location: d.branches.map((b) => ({ "@type": "Place", name: b.name, ...(b.address ? { address: b.address } : {}) })) } : {}),
  };
}
