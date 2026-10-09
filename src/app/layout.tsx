import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Orçamentos",
  description: "Sistema de orçamentos B2B",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
