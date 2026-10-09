"use client";

import { useState } from "react";
import { finishMfaAction } from "../actions";

export function RecoveryCodes({ codes }: { codes: string[] }) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const text = `TechMaster Orçamentos — códigos de recuperação do 2FA\nCada código vale uma vez.\n\n${codes.join("\n")}\n`;

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2.5 rounded-xl border border-[#24543a] bg-[#12261a]/80 px-3.5 py-3 text-sm text-[#8be3a6]">
        <span aria-hidden>✓</span>
        <span>Autenticador ativado. Você já está conectado.</span>
      </div>
      <div>
        <h2 className="text-base font-semibold text-[#f4f3fc]">Guarde seus códigos de recuperação</h2>
        <p className="mt-1 text-sm leading-relaxed text-[#b9b6dc]">
          Se perder o celular, cada código abaixo permite entrar <strong>uma vez</strong>. Eles não serão mostrados de novo.
        </p>
      </div>
      <ul className="grid grid-cols-2 gap-2 rounded-xl border border-white/10 bg-[#0d0b1c]/70 p-4 font-mono text-[15px] tracking-wider text-[#f4f3fc]">
        {codes.map((c) => <li key={c}>{c}</li>)}
      </ul>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(codes.join("\n"));
            setCopied(true);
          }}
          className="flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm font-medium text-[#d3d1ec] hover:bg-white/[0.08]"
        >
          {copied ? "Copiado ✓" : "Copiar"}
        </button>
        <a
          href={`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`}
          download="techmaster-codigos-recuperacao.txt"
          className="flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-center text-sm font-medium text-[#d3d1ec] hover:bg-white/[0.08]"
        >
          Baixar .txt
        </a>
      </div>
      <label className="flex items-start gap-2.5 text-sm text-[#d3d1ec]">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="mt-1 h-4 w-4 accent-[#6d609e]" />
        Guardei os códigos em um lugar seguro.
      </label>
      <form action={finishMfaAction}>
        <button
          type="submit"
          disabled={!saved}
          className="login-btn flex h-12 w-full items-center justify-center rounded-xl bg-[#6d609e] text-[15px] font-semibold text-[#fff] shadow-[0_10px_30px_-10px_rgba(109,96,158,0.9)] transition hover:bg-[#7d70b3] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#3bb3c2]/40 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Continuar
        </button>
      </form>
    </div>
  );
}
