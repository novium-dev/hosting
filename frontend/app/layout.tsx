import type { Metadata } from "next";
import { Geist, Geist_Mono, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { NOVIUM_LOGO_PNG_URL, NOVIUM_LOGO_SVG_URL } from "@/components/brand/novium-logo";
import { Providers } from "@/components/providers";
import NextTopLoader from "nextjs-toploader";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const jetBrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: "Hephaestus",
  description: "Hephaestus game panel for managing your servers.",
  icons: {
    icon: NOVIUM_LOGO_SVG_URL,
    apple: NOVIUM_LOGO_PNG_URL,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${jetBrainsMono.variable} antialiased`}
      >
        <NextTopLoader showSpinner={false} />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
