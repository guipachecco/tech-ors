import Link from "next/link";
import { logoutAction } from "@/app/login/actions";
import { AppNav } from "@/ui/AppNav";
import { Logo } from "@/ui/Logo";
import { ThemeToggle } from "@/ui/ThemeToggle";
import { requireUser } from "@/app/_shared/session";
import { can } from "@/modules/auth/permissions";

export const dynamic = "force-dynamic";
// Importações, fotos e PDFs podem demorar mais que o padrão de uma função na Vercel.
export const maxDuration = 60;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const admin = can(user, "settings:manage");
  const links = [
    { href: "/orcamentos", label: "Orçamentos" },
    { href: "/produtos", label: "Produtos" },
    { href: "/clientes", label: "Clientes" },
    { href: "/fornecedores", label: "Fornecedores" },
    ...(admin ? [{ href: "/configuracoes", label: "Regras e configurações" }, { href: "/usuarios", label: "Usuários" }] : []),
  ];
  return (
    <div className="min-h-screen">
      <header
        className="no-print sticky top-0 z-20 border-b backdrop-blur"
        style={{ background: "var(--header-bg)", borderColor: "var(--header-border)" }}
      >
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <Link href="/orcamentos" className="flex items-center gap-2.5" aria-label="TechMaster · Orçamentos">
              <Logo mark className="h-9 w-9" alt="" />
              <span className="leading-none">
                <span className="block text-[15px] font-semibold tracking-wide text-slate-900">
                  TECH<span className="font-light">MASTER</span>
                </span>
                <span className="mt-1 block text-[10px] font-medium uppercase tracking-[0.28em] text-slate-500">Orçamentos</span>
              </span>
            </Link>
            <AppNav links={links} />
          </div>
          <div className="flex items-center gap-3 text-sm">
            <div className="hidden text-right leading-tight sm:block">
              <div className="font-medium text-slate-800">{user.nome}</div>
              <div className="text-xs text-slate-500">{user.perfil === "root" ? "Root" : user.perfil === "administrador" ? "Administrador" : "Vendedor"}</div>
            </div>
            <ThemeToggle />
            <form action={logoutAction}>
              <button
                type="submit"
                className="inline-flex h-9 items-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Sair
              </button>
            </form>
          </div>
        </div>
        <div className="h-[2px] w-full" style={{ background: "linear-gradient(90deg,#6d609e,#3bb3c2 55%,#84c225)" }} aria-hidden />
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
