"use client";

/** Marca ou desmarca todas as caixas de um nome dentro do mesmo formulário. */
export function SelectAll({ name, label = "Marcar todas" }: { name: string; label?: string }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-600">
      <input
        type="checkbox"
        onChange={(e) => {
          const form = e.currentTarget.form;
          form?.querySelectorAll<HTMLInputElement>(`input[type=checkbox][name="${name}"]`).forEach((c) => (c.checked = e.currentTarget.checked));
        }}
      />
      {label}
    </label>
  );
}
