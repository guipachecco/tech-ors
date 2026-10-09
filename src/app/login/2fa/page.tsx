import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { AuthBackground } from "@/components/AuthBackground";
import { MFA_COOKIE } from "@/server/auth/current";
import { getChallenge, prepareEnrollment } from "@/server/auth/mfa";
import { totpKey } from "@/server/auth/totpKey";
import { getDb } from "@/server/db/client";
import { CodeForm } from "./CodeForm";
import { EnrollForm } from "./EnrollForm";

export const metadata: Metadata = { title: "Verificação em duas etapas" };
export const dynamic = "force-dynamic";

export default async function TwoFactorPage() {
  const token = (await cookies()).get(MFA_COOKIE)?.value ?? "";
  const db = getDb();
  const challenge = getChallenge(db, token);
  if (!challenge) redirect("/login");

  let enroll: { qr: string; secret: string } | null = null;
  if (!challenge.totpAtivo) {
    const prep = prepareEnrollment(db, totpKey(), token);
    if (!prep) redirect("/login");
    // QR gerado aqui no servidor: o segredo nunca é enviado a um serviço externo.
    const qr = await QRCode.toDataURL(prep.uri, { margin: 1, width: 376, errorCorrectionLevel: "M", color: { dark: "#0b0a16", light: "#ffffff" } });
    enroll = { qr, secret: prep.secret };
  }

  return (
    <main className="relative isolate flex min-h-screen items-center justify-center overflow-hidden px-6 py-10 text-[#f4f3fc]" style={{ colorScheme: "dark" }}>
      <AuthBackground />
      <div className="login-rise w-full max-w-[26rem]">
        <div className="mb-7 flex justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-dark.svg" alt="TechMaster Informática" className="w-48" />
        </div>
        <div className="login-card relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.045] p-8 shadow-[0_30px_90px_-30px_rgba(109,96,158,0.6)] backdrop-blur-xl sm:p-9">
          <div className="mb-6 flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-[#6d609e]/20 text-[#cfc8f5]">
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6z" />
                <path d="m9 12 2 2 4-4" />
              </svg>
            </span>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">{enroll ? "Proteja sua conta" : "Verificação em duas etapas"}</h1>
              <p className="text-sm text-[#9f9bc8]">{challenge.nome}</p>
            </div>
          </div>
          {enroll ? <EnrollForm qr={enroll.qr} secret={enroll.secret} /> : <CodeForm />}
        </div>
        <p className="mt-6 text-center text-xs text-[#7d79ad]">A etapa expira em 5 minutos · © {new Date().getFullYear()} TechMaster Informática</p>
      </div>
    </main>
  );
}
