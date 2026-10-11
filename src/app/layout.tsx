import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Orçamentos · TechMaster", template: "%s · TechMaster" },
  description: "Sistema de orçamentos B2B da TechMaster Informática",
  icons: { icon: "/brand/logo-mark.svg" },
};

export const viewport: Viewport = { themeColor: "#0e0d1b" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Tema escuro é o padrão; a preferência escolhida fica num cookie simples.
  const forceLight = (await headers()).get("x-light-theme") === "1";
  const theme = forceLight || (await cookies()).get("theme")?.value === "light" ? "light" : "dark";
  return (
    <html lang="pt-BR" data-theme={theme} suppressHydrationWarning>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
