import type { MetadataRoute } from "next";
import { ROOT_DOMAIN } from "@/lib/domain";

// Search engines: the public pages (the main site, centers' sites) yes;
// the app behind sign-in and one-time links no.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/dashboard", "/students", "/teachers", "/groups", "/leads", "/payments", "/schedule", "/calendar", "/settings",
          "/admin", "/portal", "/messages", "/reports", "/exams", "/mock-tests", "/homework", "/makeups", "/certificates",
          "/announcements", "/audit-log", "/ai-materials", "/ai-insights", "/onboarding", "/auth", "/invite", "/t/",
          "/reset-password", "/verify", "/verify-email",
        ],
      },
    ],
    sitemap: `https://${ROOT_DOMAIN}/sitemap.xml`,
  };
}
