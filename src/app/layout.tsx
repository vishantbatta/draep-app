import type { Metadata, Viewport } from "next";
import { Inter, Poppins, IBM_Plex_Mono } from "next/font/google";

import { strings } from "@/lib/strings";
import { Providers } from "@/app/providers";
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
    default: `${strings.brand.name} — ${strings.brand.tagline}`,
    template: `%s · ${strings.brand.name}`,
  },
  description:
    "Design your custom blouse on the phone. A Style Captain visits your home to measure, then delivers and trials — fixes included.",
  applicationName: strings.brand.name,
  authors: [{ name: "Draep" }],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#083068",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${poppins.variable} ${plexMono.variable}`}>
      <body className="min-h-dvh bg-chalk-white text-ink-navy">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
