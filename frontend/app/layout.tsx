import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { LanguageProvider } from "@/lib/i18n-context";
import SmoothAnchors from "@/components/SmoothAnchors";
import { ROOT_DOMAIN } from "@/lib/domain";

// Where the browser supports it (Chrome and Firefox on Android), the page
// itself is resized by the on-screen keyboard, so a field at the bottom of
// a full-height screen (the chat) is never under it. iOS Safari ignores
// this; lib/use-visual-viewport.ts covers it there.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-content",
};

// The main site as search results and link previews show it; each center's
// site has its own (app/site/[subdomain]/layout.tsx).
export const metadata: Metadata = {
  metadataBase: new URL(`https://${ROOT_DOMAIN}`),
  title: { default: "TalimCRM - o'quv markazlar uchun CRM", template: "%s" },
  description: "O'quv markazni bitta tizimda boshqaring: lidlar, guruhlar, davomat, to'lovlar, o'quvchi va ota-ona kabinetlari, Telegram va AI. Bepul sinab ko'ring.",
  openGraph: { type: "website", siteName: "TalimCRM", title: "TalimCRM - o'quv markazlar uchun CRM", description: "Lidlar, guruhlar, davomat, to'lovlar, kabinetlar, Telegram va AI - bitta tizimda.", locale: "uz_UZ" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="uz">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Inter:wght@400;500;600&display=swap"
        />
      </head>
      <body>
        <SmoothAnchors />
        <AuthProvider>
          <LanguageProvider>{children}</LanguageProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
