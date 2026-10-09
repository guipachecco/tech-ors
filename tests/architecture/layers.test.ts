import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkImports, MODULE_RULES } from "./checker";

function readTree(dir: string, out: Record<string, string> = {}): Record<string, string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) readTree(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out[path.relative(process.cwd(), p).split(path.sep).join("/")] = fs.readFileSync(p, "utf8");
  }
  return out;
}

describe("arquitetura em camadas", () => {
  it("o código real respeita as regras de dependência", () => {
    expect(checkImports(readTree("src"))).toEqual([]);
  });

  it("não existe pasta de módulo sem regra (toda novidade precisa ser declarada)", () => {
    const dirs = fs.readdirSync("src/modules", { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
    expect(dirs).toEqual(Object.keys(MODULE_RULES).sort());
  });

  // Garante que a trava de fato pega violações (senão o teste acima poderia passar à toa).
  describe("detecta violações", () => {
    const run = (file: string, code: string) => checkImports({ [file]: code });

    it("camada de baixo importando a de cima", () => {
      expect(run("src/domain/x.ts", 'import { a } from "@/infra/audit";')).toHaveLength(1);
      expect(run("src/modules/auth/x.ts", 'import { a } from "@/app/_shared/session";')).toHaveLength(1);
      expect(run("src/ui/x.tsx", 'import type { A } from "@/app/_shared/actions";')).toHaveLength(1);
      expect(run("src/infra/x.ts", 'import { a } from "../modules/auth/password";')).toHaveLength(1);
    });

    it("módulo dependendo de módulo não autorizado", () => {
      expect(run("src/modules/auth/x.ts", 'import { q } from "@/modules/quotes/service";')).toHaveLength(1);
      expect(run("src/modules/catalog/products/x.ts", 'import { q } from "@/modules/quotes/guard";')).toHaveLength(1);
      expect(run("src/modules/quotes/x.ts", 'import { p } from "@/modules/catalog/products/service";')).toEqual([]);
    });

    it("framework dentro de domain, infra ou módulos; import dinâmico também conta", () => {
      expect(run("src/modules/users/x.ts", 'import { cookies } from "next/headers";')).toHaveLength(1);
      expect(run("src/domain/x.ts", 'import React from "react";')).toHaveLength(1);
      expect(run("src/infra/x.ts", 'const m = await import("next/cache");')).toHaveLength(1);
      expect(run("src/modules/exports/x.tsx", 'import { Document } from "@react-pdf/renderer";')).toEqual([]);
    });

    it("pasta de camada inexistente (ex.: a antiga src/server)", () => {
      expect(run("src/server/x.ts", "export const a = 1;")).toHaveLength(1);
    });

    it("a camada app pode usar tudo abaixo dela", () => {
      const code = 'import a from "@/ui/primitives";\nimport b from "@/modules/quotes/service";\nimport c from "@/infra/db/client";\nimport d from "@/domain/money";';
      expect(run("src/app/(app)/x/page.tsx", code)).toEqual([]);
    });
  });
});
