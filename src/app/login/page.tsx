import type { Metadata } from "next";
import { AuthBackground } from "@/ui/AuthBackground";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Entrar" };

const FEATURES = [
  {
    title: "Custos sempre com validade",
    text: "Preço vencido não entra em proposta. Cada custo guarda fornecedor, data e link de origem.",
    color: "#3bb3c2",
    icon: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  },
  {
    title: "Margem sob controle",
    text: "Regras por fabricante e categoria, com margem mínima e liberação registrada.",
    color: "#84c225",
    icon: <><path d="M4 19V9M10 19V5M16 19v-7M22 19H2" /></>,
  },
  {
    title: "PDF e XLSX prontos",
    text: "Propostas com a identidade TechMaster, sem expor custo nem margem ao cliente.",
    color: "#9a8fd6",
    icon: <><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5M10 13h6M10 17h6" /></>,
  },
];

export default function LoginPage() {
  return (
    <main className="relative isolate min-h-screen overflow-hidden text-[#f4f3fc]" style={{ colorScheme: "dark" }}>
      <AuthBackground />

      <div className="mx-auto grid min-h-screen w-full max-w-6xl items-center gap-14 px-6 py-8 lg:grid-cols-[1.12fr_0.88fr] lg:px-10">
        {/* Painel da marca */}
        <section className="hidden lg:block">
          <div className="login-rise relative w-[250px]">
            <div className="absolute -inset-10 -z-10 rounded-full bg-[#6d609e]/25 blur-3xl" aria-hidden />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/logo-dark.svg" alt="TechMaster Informática" className="w-full drop-shadow-[0_12px_40px_rgba(109,96,158,0.35)]" />
          </div>

          <h1 className="login-rise d1 mt-9 max-w-xl text-[2.3rem] font-semibold leading-[1.1] tracking-tight">
            Do pedido do cliente à proposta,{" "}
            <span className="bg-gradient-to-r from-[#b5aaf0] via-[#7fd3dd] to-[#b7e36a] bg-clip-text text-transparent">sem retrabalho.</span>
          </h1>
          <p className="login-rise d2 mt-3 max-w-lg text-[15px] leading-relaxed text-[#b9b6dc]">
            Sistema de orçamentos B2B para equipamentos e soluções de TI — preços atualizados, margem calculada e proposta pronta em minutos.
          </p>

          <ul className="login-rise d3 mt-7 max-w-lg space-y-4">
            {FEATURES.map((f) => (
              <li key={f.title} className="flex gap-4">
                <span
                  className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04]"
                  style={{ color: f.color, boxShadow: `0 0 24px -6px ${f.color}66` }}
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    {f.icon}
                  </svg>
                </span>
                <div>
                  <div className="font-medium text-[#f4f3fc]">{f.title}</div>
                  <div className="mt-0.5 text-sm leading-relaxed text-[#9f9bc8]">{f.text}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* Cartão de acesso */}
        <section className="login-rise d1 mx-auto w-full max-w-[26rem]">
          <div className="mb-8 flex justify-center lg:hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/logo-dark.svg" alt="TechMaster Informática" className="w-60" />
          </div>

          <div className="login-card relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.045] p-8 shadow-[0_30px_90px_-30px_rgba(109,96,158,0.6)] backdrop-blur-xl sm:p-10">
            <div className="mb-8">
              <h2 className="text-2xl font-semibold tracking-tight">Bem-vindo de volta</h2>
              <p className="mt-1.5 text-sm text-[#9f9bc8]">Entre com seu e-mail e senha para acessar os orçamentos.</p>
            </div>
            <LoginForm />
          </div>

          <p className="mt-6 text-center text-xs text-[#7d79ad]">
            Acesso restrito a usuários autorizados · © {new Date().getFullYear()} TechMaster Informática
          </p>
        </section>
      </div>
    </main>
  );
}
