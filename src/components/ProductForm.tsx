import { ActionForm } from "./ActionForm";
import { Field, inputCls, TextInput } from "./ui";
import { saveProductAction } from "@/app/(app)/produtos/actions";
import type { ProductRow } from "@/server/catalog/products";

export function ProductForm({ product }: { product?: ProductRow }) {
  return (
    <ActionForm action={saveProductAction} submitLabel={product ? "Salvar alterações" : "Cadastrar produto"} className="space-y-4">
      {product && <input type="hidden" name="id" value={product.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="SKU interno" name="sku"><TextInput name="sku" defaultValue={product?.sku} required /></Field>
        <Field label="Categoria" name="categoria" hint="Ex.: Nobreak, Switch, SSD, Memória, Firewall">
          <TextInput name="categoria" defaultValue={product?.categoria} required />
        </Field>
        <Field label="Fabricante" name="fabricante"><TextInput name="fabricante" defaultValue={product?.fabricante} required /></Field>
        <Field label="Modelo" name="modelo"><TextInput name="modelo" defaultValue={product?.modelo} required /></Field>
      </div>
      <Field label="Descrição" name="descricao">
        <textarea id="descricao" name="descricao" rows={2} defaultValue={product?.descricao} className={inputCls} />
      </Field>
      <Field label="Especificações técnicas (opcional)" name="especificacoes">
        <textarea id="especificacoes" name="especificacoes" rows={3} defaultValue={product?.especificacoes ?? ""} className={inputCls} />
      </Field>
    </ActionForm>
  );
}
