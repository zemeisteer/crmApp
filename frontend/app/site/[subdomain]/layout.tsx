import type { Metadata } from "next";
import type { ReactNode } from "react";
import type { PublicShowcaseData } from "@/lib/api";
import { ROOT_DOMAIN } from "@/lib/domain";
import { serverGet } from "@/lib/server-api";
import { siteDescription, siteJsonLd, siteUrl } from "@/lib/site-seo";

// The page itself renders in the browser; this layout gives search engines
// and link previews (Telegram, Facebook) the center's own title, text,
// picture and address, and the center as structured data.

type Params = Promise<{ subdomain: string }>;

const showcase = (sub: string) =>
  serverGet<PublicShowcaseData>(`/tenants/by-subdomain/${encodeURIComponent(sub)}/public-showcase`);

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { subdomain } = await params;
  const data = await showcase(subdomain);
  if (!data) return { title: "TalimCRM" };
  const url = siteUrl(data.tenant, ROOT_DOMAIN);
  const description = siteDescription(data);
  const image = data.tenant.logoUrl ? new URL(data.tenant.logoUrl, url).toString() : undefined;
  return {
    title: data.site?.heroTitle ? `${data.tenant.name} - ${data.site.heroTitle}` : data.tenant.name,
    description,
    alternates: { canonical: url },
    openGraph: { type: "website", url, siteName: data.tenant.name, title: data.tenant.name, description, images: image ? [{ url: image }] : undefined },
    twitter: { card: image ? "summary_large_image" : "summary", title: data.tenant.name, description },
  };
}

export default async function SiteLayout({ children, params }: { children: ReactNode; params: Params }) {
  const { subdomain } = await params;
  const data = await showcase(subdomain);
  return (
    <>
      {data && (
        <script
          type="application/ld+json"
          // Our own JSON (no user HTML): "<" is escaped so no text can close the tag.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(siteJsonLd(data, ROOT_DOMAIN)).replace(/</g, "\\u003c") }}
        />
      )}
      {children}
    </>
  );
}
