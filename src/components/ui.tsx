import type { ReactNode } from "react";

export const inputCls =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-slate-100";
export const btnPrimary =
  "inline-flex items-center justify-center rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-800 disabled:opacity-50";
export const btnSecondary =
  "inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50";
export const btnDanger =
  "inline-flex items-center justify-center rounded-md border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, children, className = "" }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-slate-200 bg-white p-5 shadow-sm ${className}`}>
      {title && <h2 className="mb-4 text-base font-semibold text-slate-800">{title}</h2>}
      {children}
    </section>
  );
}

export function Field({
  label, name, hint, children, className = "",
}: { label: string; name: string; hint?: string; children?: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`} htmlFor={name}>
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement> & { name: string }) {
  return <input id={props.name} {...props} className={`${inputCls} ${props.className ?? ""}`} />;
}

export function Alert({ kind, children }: { kind: "error" | "warn" | "ok" | "info"; children: ReactNode }) {
  const styles = {
    error: "border-red-200 bg-red-50 text-red-800",
    warn: "border-amber-200 bg-amber-50 text-amber-900",
    ok: "border-green-200 bg-green-50 text-green-800",
    info: "border-brand-100 bg-brand-50 text-brand-800",
  }[kind];
  return <div className={`rounded-md border px-3 py-2 text-sm ${styles}`}>{children}</div>;
}

const BADGES: Record<string, string> = {
  valido: "bg-green-100 text-green-800",
  vencido: "bg-red-100 text-red-800",
  sem_preco: "bg-slate-200 text-slate-700",
  em_elaboracao: "bg-slate-200 text-slate-700",
  enviado: "bg-brand-100 text-brand-800",
  aprovado: "bg-green-100 text-green-800",
  recusado: "bg-red-100 text-red-800",
  expirado: "bg-amber-100 text-amber-900",
};
const LABELS: Record<string, string> = {
  valido: "Custo válido",
  vencido: "Custo vencido",
  sem_preco: "Sem preço",
  em_elaboracao: "Em elaboração",
  enviado: "Enviado",
  aprovado: "Aprovado",
  recusado: "Recusado",
  expirado: "Expirado",
};

export function Badge({ kind, children }: { kind: string; children?: ReactNode }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${BADGES[kind] ?? "bg-slate-100"}`}>
      {children ?? LABELS[kind] ?? kind}
    </span>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="rounded-md border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">{children}</div>;
}

export const thCls = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500";
export const tdCls = "px-3 py-2 text-sm";
