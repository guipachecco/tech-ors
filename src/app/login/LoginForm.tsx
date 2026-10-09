"use client";

import { useActionState, useId, useState } from "react";
import { loginAction } from "./actions";

const fieldCls =
  "peer block w-full rounded-xl border border-white/10 bg-[#0d0b1c]/70 py-3 pl-11 pr-4 text-[15px] text-[#f4f3fc] placeholder:text-[#7d79ad] outline-none transition " +
  "focus:border-[#9a8fd6] focus:bg-[#0d0b1c] focus:ring-4 focus:ring-[#6d609e]/30";

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[#7d79ad] transition-colors peer-focus:text-[#b5aaf0]">
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
    </span>
  );
}

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, null);
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  const emailId = useId();
  const passId = useId();
  const errId = useId();

  return (
    <form action={formAction} className="space-y-5" noValidate={false}>
      <div>
        <label htmlFor={emailId} className="mb-1.5 block text-sm font-medium text-[#d3d1ec]">E-mail</label>
        <div className="relative">
          <input
            id={emailId}
            name="email"
            type="email"
            autoComplete="username"
            inputMode="email"
            required
            autoFocus
            placeholder="voce@empresa.com.br"
            className={fieldCls}
            aria-describedby={state?.error ? errId : undefined}
          />
          <Icon>
            <rect x="3" y="5" width="18" height="14" rx="2.5" />
            <path d="m3.5 7 8.5 6 8.5-6" />
          </Icon>
        </div>
      </div>

      <div>
        <label htmlFor={passId} className="mb-1.5 block text-sm font-medium text-[#d3d1ec]">Senha</label>
        <div className="relative">
          <input
            id={passId}
            name="senha"
            type={show ? "text" : "password"}
            autoComplete="current-password"
            required
            placeholder="Sua senha"
            className={`${fieldCls} pr-12`}
            onKeyUp={(e) => setCaps(e.getModifierState("CapsLock"))}
            onBlur={() => setCaps(false)}
            aria-describedby={state?.error ? errId : undefined}
          />
          <Icon>
            <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
            <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
          </Icon>
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? "Ocultar senha" : "Mostrar senha"}
            aria-pressed={show}
            className="absolute right-2 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-[#9f9bc8] transition hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9a8fd6]"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              {show ? (
                <>
                  <path d="M3 3l18 18" />
                  <path d="M10.6 6.2A9.8 9.8 0 0 1 12 6c5 0 8.5 4.2 9.5 6-0.4 0.8-1.2 2-2.3 3.1M6.6 6.9C4.4 8.3 3 10.4 2.5 12c1 1.8 4.5 6 9.5 6 1.5 0 2.8-.4 4-1" />
                  <path d="M9.9 10a3 3 0 0 0 4.1 4.1" />
                </>
              ) : (
                <>
                  <path d="M2.5 12C3.5 10.2 7 6 12 6s8.5 4.2 9.5 6c-1 1.8-4.5 6-9.5 6S3.5 13.8 2.5 12Z" />
                  <circle cx="12" cy="12" r="3" />
                </>
              )}
            </svg>
          </button>
        </div>
        {caps && (
          <p className="mt-1.5 flex items-center gap-1.5 text-xs text-[#ffd98a]" role="status">
            <span aria-hidden>⇪</span> Caps Lock está ligado
          </p>
        )}
      </div>

      <div id={errId} aria-live="polite">
        {state?.error && (
          <div className="flex items-start gap-2.5 rounded-xl border border-[#5c2430] bg-[#2a1219]/80 px-3.5 py-3 text-sm text-[#ffa3b1]" role="alert">
            <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7.5v5M12 16.2v.1" />
            </svg>
            <span>{state.error}</span>
          </div>
        )}
      </div>

      <button
        type="submit"
        disabled={pending}
        className="login-btn group relative flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#6d609e] text-[15px] font-semibold text-[#fff] shadow-[0_10px_30px_-10px_rgba(109,96,158,0.9)] transition hover:bg-[#7d70b3] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#3bb3c2]/40 disabled:cursor-wait disabled:opacity-80"
      >
        {pending ? (
          <>
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".3" strokeWidth="3" />
              <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
            Entrando…
          </>
        ) : (
          <>
            Entrar
            <svg viewBox="0 0 24 24" className="h-4 w-4 transition-transform group-hover:translate-x-0.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </>
        )}
      </button>
    </form>
  );
}
