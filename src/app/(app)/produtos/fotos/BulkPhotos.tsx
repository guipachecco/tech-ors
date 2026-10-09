"use client";

import { useRef, useState } from "react";
import { Alert, Badge, btnPrimary, btnSecondary, tdCls, thCls } from "@/components/ui";
import type { PhotoMatch } from "@/server/catalog/photoMatch";
import { previewPhotoNamesAction, uploadPhotoByNameAction } from "./actions";

const MAX_BYTES = 8 * 1024 * 1024;
const IMAGE = /\.(jpe?g|png|webp)$/i;

type Status = "pendente" | "enviando" | "ok" | "erro";
type Item = { file: File; match: PhotoMatch; include: boolean; status: Status; msg?: string };

const VIA: Record<PhotoMatch["via"], { label: string; kind: string }> = {
  sku: { label: "SKU", kind: "valido" },
  codigo: { label: "Código do fornecedor", kind: "valido" },
  nome: { label: "Nome do modelo", kind: "enviado" },
  amplo: { label: "Nome amplo demais", kind: "expirado" },
  nenhum: { label: "Sem correspondência", kind: "vencido" },
};

export function BulkPhotos() {
  const [items, setItems] = useState<Item[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ arquivos: number; produtos: number; erros: number } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  async function onPick(list: FileList | null) {
    if (!list || list.length === 0) return;
    setDone(null);
    setLoadError(null);
    const ignored: string[] = [];
    const seen = new Set<string>();
    const files: File[] = [];
    for (const f of Array.from(list)) {
      if (!IMAGE.test(f.name)) { ignored.push(`${f.name}: não é JPG, PNG ou WebP`); continue; }
      if (f.size > MAX_BYTES) { ignored.push(`${f.name}: passa de 8 MB`); continue; }
      const key = f.name.toLowerCase();
      if (seen.has(key)) { ignored.push(`${f.name}: nome repetido`); continue; }
      seen.add(key);
      files.push(f);
    }
    setSkipped(ignored);
    try {
      const matches: PhotoMatch[] = [];
      for (let i = 0; i < files.length; i += 500) {
        matches.push(...(await previewPhotoNamesAction(files.slice(i, i + 500).map((f) => f.name))));
      }
      setItems(files.map((file, i) => ({
        file,
        match: matches[i],
        include: matches[i] ? ["sku", "codigo", "nome"].includes(matches[i].via) : false,
        status: "pendente",
      })));
    } catch {
      setLoadError("Não consegui analisar os nomes. Recarregue a página e tente de novo.");
    }
  }

  async function send() {
    const queue = items.map((it, idx) => ({ it, idx })).filter(({ it }) => it.include && it.status !== "ok");
    if (queue.length === 0) return;
    setBusy(true);
    setDone(null);
    let produtos = 0;
    let erros = 0;
    let next = 0;
    const patch = (idx: number, p: Partial<Item>) => setItems((cur) => cur.map((x, i) => (i === idx ? { ...x, ...p } : x)));

    async function worker() {
      while (next < queue.length) {
        const { it, idx } = queue[next++];
        patch(idx, { status: "enviando", msg: undefined });
        const fd = new FormData();
        fd.set("foto", it.file);
        fd.set("nome", it.file.name);
        fd.set("substituir", replace ? "1" : "0");
        try {
          const r = await uploadPhotoByNameAction(fd);
          if (r.ok) {
            produtos += r.salvos;
            patch(idx, { status: "ok", msg: r.salvos === 0 ? "Nada a gravar (já tinham foto)" : `${r.salvos} produto(s)${r.ignorados ? `, ${r.ignorados} já tinham foto` : ""}` });
          } else {
            erros++;
            patch(idx, { status: "erro", msg: r.error });
          }
        } catch {
          erros++;
          patch(idx, { status: "erro", msg: "Falha de conexão" });
        }
      }
    }
    await Promise.all([worker(), worker()]); // 2 envios por vez
    setBusy(false);
    setDone({ arquivos: queue.length - erros, produtos, erros });
  }

  const selected = items.filter((i) => i.include).length;
  const finished = items.filter((i) => i.include && (i.status === "ok" || i.status === "erro")).length;
  const counts = {
    casados: items.filter((i) => ["sku", "codigo", "nome"].includes(i.match.via)).length,
    sem: items.filter((i) => i.match.via === "nenhum").length,
    amplos: items.filter((i) => i.match.via === "amplo").length,
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <input ref={filesRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => { void onPick(e.target.files); e.target.value = ""; }} />
        <input ref={folderRef} type="file" hidden multiple {...({ webkitdirectory: "" } as object)} onChange={(e) => { void onPick(e.target.files); e.target.value = ""; }} />
        <button type="button" className={btnPrimary} disabled={busy} onClick={() => filesRef.current?.click()}>Escolher fotos</button>
        <button type="button" className={btnSecondary} disabled={busy} onClick={() => folderRef.current?.click()}>Escolher uma pasta</button>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} disabled={busy} />
          Substituir fotos que já existem
        </label>
      </div>

      {loadError && <Alert kind="error">{loadError}</Alert>}
      {skipped.length > 0 && (
        <Alert kind="warn">
          {skipped.length} arquivo(s) ignorado(s):
          <ul className="mt-1 list-disc pl-5 text-xs">{skipped.slice(0, 8).map((s) => <li key={s}>{s}</li>)}{skipped.length > 8 && <li>… e mais {skipped.length - 8}</li>}</ul>
        </Alert>
      )}

      {items.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            <span><strong>{items.length}</strong> arquivo(s)</span>
            <span className="text-green-800">{counts.casados} com produto</span>
            {counts.sem > 0 && <span className="text-red-700">{counts.sem} sem correspondência</span>}
            {counts.amplos > 0 && <span className="text-amber-900">{counts.amplos} amplos demais</span>}
          </div>

          <div className="max-h-[55vh] overflow-auto rounded-md border border-slate-200">
            <table className="w-full">
              <thead className="sticky top-0 border-b border-slate-200 bg-white">
                <tr><th className={thCls}></th><th className={thCls}>Arquivo</th><th className={thCls}>Corresponde a</th><th className={thCls}>Situação</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100 align-top">
                {items.map((it, idx) => {
                  const usable = ["sku", "codigo", "nome"].includes(it.match.via);
                  return (
                    <tr key={it.file.name} className={usable ? undefined : "opacity-70"}>
                      <td className={tdCls}>
                        {usable && (
                          <input type="checkbox" checked={it.include} disabled={busy || it.status === "ok"} aria-label={`Enviar ${it.file.name}`}
                            onChange={(e) => setItems((cur) => cur.map((x, i) => (i === idx ? { ...x, include: e.target.checked } : x)))} />
                        )}
                      </td>
                      <td className={`${tdCls} break-all text-xs`}>{it.file.name}</td>
                      <td className={tdCls}>
                        <Badge kind={VIA[it.match.via].kind}>{VIA[it.match.via].label}</Badge>
                        {it.match.via === "amplo" && <div className="mt-1 text-xs text-slate-500">{it.match.total} produtos: use o código ou um nome mais específico.</div>}
                        {it.match.produtos.length > 0 && (
                          <div className="mt-1 text-xs text-slate-600">
                            {it.match.produtos.slice(0, 2).map((p) => <div key={p.id}>{p.rotulo}{p.temFoto ? " · já tem foto" : ""}</div>)}
                            {it.match.produtos.length > 2 && <div className="text-slate-500">+ {it.match.produtos.length - 2} produto(s)</div>}
                          </div>
                        )}
                      </td>
                      <td className={`${tdCls} text-xs`}>
                        {it.status === "pendente" && <span className="text-slate-500">Aguardando</span>}
                        {it.status === "enviando" && <span className="text-brand-700">Enviando…</span>}
                        {it.status === "ok" && <span className="text-green-800">✓ {it.msg}</span>}
                        {it.status === "erro" && <span className="text-red-700">{it.msg}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <button type="button" className={btnPrimary} disabled={busy || selected === 0} onClick={() => void send()}>
              {busy ? "Enviando…" : `Enviar ${selected} foto(s)`}
            </button>
            {busy && (
              <div className="flex-1" aria-live="polite">
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                  <div className="h-full bg-[var(--btn)] transition-all" style={{ width: `${selected ? (finished / selected) * 100 : 0}%` }} />
                </div>
                <div className="mt-1 text-xs text-slate-500">{finished} de {selected}</div>
              </div>
            )}
          </div>
        </>
      )}

      {done && (
        <div aria-live="polite">
          <Alert kind={done.erros > 0 ? "warn" : "ok"}>
            Concluído: fotos gravadas em <strong>{done.produtos}</strong> produto(s) a partir de {done.arquivos} arquivo(s)
            {done.erros > 0 ? `; ${done.erros} arquivo(s) com erro (veja na lista)` : ""}.
          </Alert>
        </div>
      )}
    </div>
  );
}
