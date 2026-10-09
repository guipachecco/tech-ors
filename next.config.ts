import type { NextConfig } from "next";

// React em modo desenvolvimento usa eval() para remontar pilhas de chamadas; em produção fica bloqueado.
const devEval = process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  {
    key: "Content-Security-Policy",
    value:
      `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'${devEval}; frame-ancestors 'none'; form-action 'self'`,
  },
];

const config: NextConfig = {
  // Só afeta o modo de desenvolvimento: permite abrir o servidor de teste por 127.0.0.1 além de localhost.
  allowedDevOrigins: ["127.0.0.1"],
  // Planilhas (até 5 MB) e fotos de produtos (até 8 MB) chegam como upload; os limites exatos são conferidos no servidor.
  experimental: { serverActions: { bodySizeLimit: "10mb" } },
  serverExternalPackages: ["better-sqlite3", "@node-rs/argon2", "@react-pdf/renderer", "exceljs", "sharp"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default config;
