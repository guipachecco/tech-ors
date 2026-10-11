"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function AppNav({ links }: { links: { href: string; label: string; badge?: number }[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap items-center gap-1" aria-label="Principal">
      {links.map((l) => {
        const active = pathname === l.href || pathname.startsWith(`${l.href}/`);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className="rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
            style={{
              background: active ? "var(--nav-active-bg)" : undefined,
              color: active ? "var(--nav-active-text)" : undefined,
            }}
          >
            <span className={active ? "" : "text-slate-600 hover:text-slate-900"}>{l.label}</span>
            {!!l.badge && <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-semibold text-white" aria-label={`${l.badge} pendente(s)`}>{l.badge}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
