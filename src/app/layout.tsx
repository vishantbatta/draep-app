import type { Metadata, Viewport } from "next";
import { Inter, Poppins, IBM_Plex_Mono } from "next/font/google";

import { strings } from "@/lib/strings";
import { Providers } from "@/app/providers";
import { ServiceWorkerRegister } from "@/components/layout/ServiceWorkerRegister";
import "@/styles/globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-poppins",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Draep - Stitch Your Wish",
    template: `%s · ${strings.brand.name}`,
  },
  description:
    "Design your custom blouse on the phone. A Style Captain visits your home to measure, then delivers and trials — fixes included.",
  applicationName: strings.brand.name,
  authors: [{ name: "Draep" }],
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "draep",
    // "default" keeps content below the notch/Dynamic Island in the installed
    // iOS app (black-translucent slides every page under it, with white
    // status-bar text that's unreadable on our light headers).
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    // Square renders of logo_alpha_icon.png (public/icons/) — iOS requires a
    // square apple-touch-icon and squashes/letterboxes non-square ones.
    icon: [
      { url: "/icons/icon-192x192.png", type: "image/png", sizes: "192x192" },
    ],
    shortcut: [{ url: "/icons/icon-192x192.png", type: "image/png" }],
    apple: [{ url: "/icons/icon-512x512.png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  minimumScale: 1,
  maximumScale: 1,
  userScalable: false,
  // No viewportFit "cover": on iOS 26 standalone PWAs, cover can extend the
  // layout under the notch even with the "default" status bar style. Without
  // cover the viewport stops below the status bar / above the home indicator,
  // so overlap is impossible. Safe-area paddings (pb-safe) become no-ops.
  themeColor: "#083068",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${poppins.variable} ${plexMono.variable}`}>
      <body className="min-h-dvh bg-chalk-white text-ink-navy">
        <ServiceWorkerRegister />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
