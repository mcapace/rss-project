import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { THEME_BOOT_SCRIPT } from "@/lib/editorial/theme";
import "./globals.css";
import "@/components/editorial/editorial.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "M. Shanken — Editorial workspace",
  description:
    "An in-house editorial workspace for articles, ratings, pages, and print-to-web drafts.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">
        {/* Applies the stored light or dark theme before the first paint on every page. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        <div className="flex-1 flex flex-col">{children}</div>
      </body>
    </html>
  );
}
