"use client";

import { useActionState, type ReactNode } from "react";
import type { ActionState } from "@/server/actions";
import { Alert, btnPrimary } from "./ui";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export function ActionForm({
  action, submitLabel = "Salvar", children, className = "", secondary,
}: { action: Action; submitLabel?: string; children: ReactNode; className?: string; secondary?: ReactNode }) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className={className}>
      {children}
      {state?.error && <div className="mt-3"><Alert kind="error">{state.error}</Alert></div>}
      {state?.ok && <div className="mt-3"><Alert kind="ok">{state.ok}</Alert></div>}
      <div className="mt-4 flex items-center gap-2">
        <button type="submit" disabled={pending} className={btnPrimary}>
          {pending ? "Salvando…" : submitLabel}
        </button>
        {secondary}
      </div>
    </form>
  );
}

/** Formulário compacto de uma linha, usado em botões de ação (sem campos extras). */
export function InlineAction({
  action, label, className = "", confirm, children,
}: { action: Action; label: string; className?: string; confirm?: string; children?: ReactNode }) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form
      action={formAction}
      className="inline-flex flex-col gap-1"
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
      <button type="submit" disabled={pending} className={className}>
        {pending ? "…" : label}
      </button>
      {state?.error && <span className="max-w-xs text-xs text-red-700">{state.error}</span>}
    </form>
  );
}

/** Envia o formulário ao sair do campo (blur) quando o valor mudou. */
export function AutoSaveForm({ action, children, className = "" }: { action: Action; children: ReactNode; className?: string }) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form
      action={formAction}
      className={className}
      onBlur={(e) => {
        const t = e.target as unknown as HTMLInputElement;
        if (t.tagName === "INPUT" && t.value !== t.defaultValue) t.form?.requestSubmit();
      }}
    >
      {children}
      {state?.error && <p className="mt-1 text-xs text-red-700">{state.error}</p>}
    </form>
  );
}
