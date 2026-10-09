import { ActionForm } from "@/components/ActionForm";
import { Field, TextInput } from "@/components/ui";
import { loginAction } from "./actions";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-brand-700">Orçamentos</h1>
        <p className="mb-6 mt-1 text-sm text-slate-500">Entre com seu e-mail e senha.</p>
        <ActionForm action={loginAction} submitLabel="Entrar" className="space-y-4">
          <Field label="E-mail" name="email">
            <TextInput name="email" type="email" autoComplete="username" required autoFocus />
          </Field>
          <Field label="Senha" name="senha">
            <TextInput name="senha" type="password" autoComplete="current-password" required />
          </Field>
        </ActionForm>
      </div>
    </main>
  );
}
