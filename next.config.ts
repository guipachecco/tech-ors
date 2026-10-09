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
  serverExternalPackages: ["better-sqlite3", "@node-rs/argon2", "@react-pdf/renderer", "exceljs"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default config;
