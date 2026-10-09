"use client";

import { useActionState, useId, useRef, useState } from "react";
import { cancelMfaAction, verifyCodeAction } from "./actions";

const fieldCls =
  "block w-full rounded-xl border border-white/10 bg-[#0d0b1c]/70 px-4 py-3.5 text-center font-mono text-2xl tracking-[0.5em] text-[#f4f3fc] placeholder:text-[#4d4a7a] outline-none transition " +
  "focus:border-[#9a8fd6] focus:bg-[#0d0b1c] focus:ring-4 focus:ring-[#6d609e]/30";

export function CodeForm() {
  const [state, formAction, pending] = useActionState(verifyCodeAction, null);
  const [recovery, setRecovery] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const id = useId();

  return (
    <div>
      <form ref={formRef} action={formAction} className="space-y-5">
        <div>
          <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-[#d3d1ec]">
            {recovery ? "Código de recuperação" : "Código do aplicativo"}
          </label>
          {recovery ? (
            <input
              key="rec"
              id={id}
              name="codigo"
              type="text"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              required
              autoFocus
              placeholder="XXXXX-XXXXX"
              maxLength={16}
              className={`${fieldCls} !text-lg !tracking-[0.2em]`}
            />
          ) : (
            <input
              key="totp"
              id={id}
              name="codigo"
              type="text"
              inputMode="numeric"
              pattern="[0-9 ]*"
              autoComplete="one-time-code"
              required
              autoFocus
              placeholder="000000"
              maxLength={7}
              className={fieldCls}
              onChange={(e) => {
                if (e.target.value.replace(/\D/g, "").length === 6) formRef.current?.requestSubmit();
              }}
            />
          )}
          <p className="mt-2 text-xs text-[#9f9bc8]">
            {recovery
              ? "Use um dos códigos de uso único que você guardou ao configurar o 2FA."
              : "Abra o Google Authenticator e digite o código de 6 dígitos de “TechMaster Orçamentos”."}
          </p>
        </div>

        {state?.error && (
          <div className="flex items-start gap-2.5 rounded-xl border border-[#5c2430] bg-[#2a1219]/80 px-3.5 py-3 text-sm text-[#ffa3b1]" role="alert">
            <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7.5v5M12 16.2v.1" />
            </svg>
            <span>{state.error}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={pending}
          className="login-btn flex h-12 w-full items-center justify-center rounded-xl bg-[#6d609e] text-[15px] font-semibold text-[#fff] shadow-[0_10px_30px_-10px_rgba(109,96,158,0.9)] transition hover:bg-[#7d70b3] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#3bb3c2]/40 disabled:cursor-wait disabled:opacity-80"
        >
          {pending ? "Verificando…" : "Verificar e entrar"}
        </button>
      </form>

      <div className="mt-5 flex items-center justify-between text-sm">
        <button type="button" onClick={() => setRecovery((v) => !v)} className="text-[#b5aaf0] underline-offset-4 hover:underline">
          {recovery ? "Usar o aplicativo" : "Usar código de recuperação"}
        </button>
        <form action={cancelMfaAction}>
          <button type="submit" className="text-[#9f9bc8] underline-offset-4 hover:text-white hover:underline">Voltar</button>
        </form>
      </div>
    </div>
  );
}
