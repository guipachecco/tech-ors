import Link from "next/link";
import { logoutAction } from "@/app/login/actions";
import { btnSecondary } from "@/components/ui";
import { requireUser } from "@/server/auth/current";
import { can } from "@/server/auth/permissions";

export const dynamic = "force-dynamic";

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
      <header className="no-print border-b border-slate-200 bg-brand-700 text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <nav className="flex flex-wrap items-center gap-1">
            <span className="mr-4 text-lg font-semibold">Orçamentos</span>
            {links.map((l) => (
              <Link key={l.href} href={l.href} className="rounded px-3 py-1.5 text-sm hover:bg-white/10">
                {l.label}
              </Link>
            ))}
          </nav>
          <form action={logoutAction} className="flex items-center gap-3 text-sm">
            <span className="text-brand-100">{user.nome}</span>
            <button type="submit" className={`${btnSecondary} !py-1`}>Sair</button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
