import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import "./globals.css";

import { AppProviders } from "./providers/app-providers";

const themeScript = `
  try {
    var theme = localStorage.getItem("bodega-hub:theme");
    var resolvedTheme = theme === "dark" || theme === "light" ? theme : "light";
    document.documentElement.classList.remove("light", "dark");
    document.documentElement.classList.add(resolvedTheme);
    document.documentElement.style.colorScheme = resolvedTheme;
  } catch (_) {
    document.documentElement.classList.add("light");
    document.documentElement.style.colorScheme = "light";
  }
`;

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "BodegaHub ERP",
  description: "ERP web para ventas, compras, inventario y pagos.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="flex min-h-full flex-col">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
