"use client";

import { useActionState, useId } from "react";
import { cancelMfaAction, enrollAction } from "./actions";

const fieldCls =
  "block w-full rounded-xl border border-white/10 bg-[#0d0b1c]/70 px-4 py-3.5 text-center font-mono text-2xl tracking-[0.5em] text-[#f4f3fc] placeholder:text-[#4d4a7a] outline-none transition " +
  "focus:border-[#9a8fd6] focus:bg-[#0d0b1c] focus:ring-4 focus:ring-[#6d609e]/30";
const primaryBtn =
  "login-btn flex h-12 w-full items-center justify-center rounded-xl bg-[#6d609e] text-[15px] font-semibold text-[#fff] shadow-[0_10px_30px_-10px_rgba(109,96,158,0.9)] transition hover:bg-[#7d70b3] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#3bb3c2]/40 disabled:cursor-wait disabled:opacity-80";

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#6d609e]/30 text-xs font-semibold text-[#cfc8f5]">{n}</span>
      <div className="text-sm leading-relaxed text-[#d3d1ec]">{children}</div>
    </li>
  );
}

export function EnrollForm({ qr, secret }: { qr: string; secret: string }) {
  const [state, formAction, pending] = useActionState(enrollAction, null);
  const id = useId();
  const grouped = secret.replace(/(.{4})/g, "$1 ").trim();

  return (
    <div className="space-y-6">
      <ol className="space-y-4">
        <Step n={1}>Instale o <strong>Google Authenticator</strong> (ou outro app TOTP) no celular.</Step>
        <Step n={2}>
          No app, toque em <strong>+</strong> e escaneie o QR code:
          <div className="mt-3 inline-block rounded-2xl bg-white p-2.5 shadow-[0_10px_40px_-12px_rgba(109,96,158,0.7)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="QR code para o Google Authenticator" width={188} height={188} className="block" />
          </div>
          <details className="mt-3 text-[#9f9bc8]">
            <summary className="cursor-pointer text-[#b5aaf0]">Não consegue escanear? Digite a chave</summary>
            <p className="mt-2 break-all rounded-lg bg-[#0d0b1c]/70 px-3 py-2 font-mono text-sm tracking-wider text-[#f4f3fc]">{grouped}</p>
            <p className="mt-1 text-xs">Tipo: baseada em tempo · 6 dígitos.</p>
          </details>
        </Step>
        <Step n={3}>Digite o código de 6 dígitos que o app mostrar:</Step>
      </ol>

      <form action={formAction} className="space-y-4">
        <div>
          <label htmlFor={id} className="sr-only">Código de 6 dígitos</label>
          <input
            id={id}
            name="codigo"
            type="text"
            inputMode="numeric"
            pattern="[0-9 ]*"
            autoComplete="one-time-code"
            required
            placeholder="000000"
            maxLength={7}
            className={fieldCls}
          />
        </div>
        {state?.error && (
          <div className="flex items-start gap-2.5 rounded-xl border border-[#5c2430] bg-[#2a1219]/80 px-3.5 py-3 text-sm text-[#ffa3b1]" role="alert">
            <span aria-hidden>!</span>
            <span>{state.error}</span>
          </div>
        )}
        <button type="submit" disabled={pending} className={primaryBtn}>
          {pending ? "Verificando…" : "Ativar e entrar"}
        </button>
      </form>

      <form action={cancelMfaAction} className="text-center">
        <button type="submit" className="text-sm text-[#9f9bc8] underline-offset-4 hover:text-white hover:underline">Cancelar e voltar</button>
      </form>
    </div>
  );
}
