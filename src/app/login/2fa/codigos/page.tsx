import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AuthBackground } from "@/ui/AuthBackground";
import { getCurrentUser, RECOVERY_COOKIE } from "@/app/_shared/session";
import { decryptSecret } from "@/modules/auth/totp";
import { totpKey } from "@/modules/auth/totpKey";
import { RecoveryCodes } from "./RecoveryCodes";

export const metadata: Metadata = { title: "Códigos de recuperação" };
export const dynamic = "force-dynamic";

function readCodes(blob: string | undefined): string[] | null {
  if (!blob) return null;
  try {
    const codes = JSON.parse(decryptSecret(blob, totpKey()));
    return Array.isArray(codes) && codes.every((c) => typeof c === "string") ? codes : null;
  } catch {
    return null;
  }
}

export default async function RecoveryCodesPage() {
  // Só quem acabou de configurar o 2FA (sessão + cookie criptografado de curta duração) chega aqui.
  const user = await getCurrentUser();
  const codes = readCodes((await cookies()).get(RECOVERY_COOKIE)?.value);
  if (!user || !codes) redirect("/orcamentos");

  return (
    <main className="relative isolate flex min-h-screen items-center justify-center overflow-hidden px-6 py-10 text-[#f4f3fc]" style={{ colorScheme: "dark" }}>
      <AuthBackground />
      <div className="login-rise w-full max-w-[26rem]">
        <div className="login-card relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.045] p-8 shadow-[0_30px_90px_-30px_rgba(109,96,158,0.6)] backdrop-blur-xl sm:p-9">
          <RecoveryCodes codes={codes} />
        </div>
      </div>
    </main>
  );
}
