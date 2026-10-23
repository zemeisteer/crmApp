import type { MetadataRoute } from "next";
import { ROOT_DOMAIN } from "@/lib/domain";
import { serverGet } from "@/lib/server-api";
import { siteUrl } from "@/lib/site-seo";

// The main site's pages and every center's public site (refreshed hourly).
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const main = `https://${ROOT_DOMAIN}`;
  const pages: MetadataRoute.Sitemap = [
    { url: `${main}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${main}/register`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${main}/login`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${main}/privacy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${main}/terms`, changeFrequency: "yearly", priority: 0.2 },
  ];
  const centers = (await serverGet<Array<{ subdomain: string; customDomain: string | null; updatedAt: string }>>("/tenants/public-sitemap", 3600)) ?? [];
  return [
    ...pages,
    ...centers.map((c) => ({ url: siteUrl(c, ROOT_DOMAIN), lastModified: c.updatedAt, changeFrequency: "weekly" as const, priority: 0.6 })),
  ];
}
